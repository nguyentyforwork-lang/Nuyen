const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/store');
const { createScanner } = require('../src/scanner');

function fakeClient() {
  const state = { statuses: { '1': 'STATUS_ENABLE', '2': 'STATUS_LIMIT' }, adStatus: 'AD_STATUS_AUDIT_DENY', appeals: [] };
  return {
    state,
    async listAuthorizedAdvertisers() { return [{ advertiser_id: '1', name: 'A' }, { advertiser_id: '2', name: 'B' }]; },
    async listBcAdvertisers() { return []; },
    async getAdvertiserInfo(ids) { return ids.map((id) => ({ advertiser_id: id, name: id, status: state.statuses[id] })); },
    async getAds(adv) { return adv === '1' ? [{ ad_id: '11', adgroup_id: '101', campaign_id: '1001', ad_name: 'ad', secondary_status: state.adStatus }] : []; },
    async getAdReviewInfo(adv, ids) { return Object.fromEntries(ids.map((id) => [id, { is_approved: false, reject_info: [{ reason: 'Misleading' }] }])); },
    async appealAdgroup(p) { state.appeals.push(p); return {}; },
  };
}

function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nuyen-')), 'db.json');
  const client = fakeClient();
  const store = createStore(file);
  return { client, store, scanner: createScanner({ client, store, env: {}, log: { info() {} } }) };
}

test('tracks suspension date and estimated flag', async () => {
  const { client, store, scanner } = setup();
  await scanner.scanAccounts();
  assert.equal(store.db.accounts['2'].suspended, true);
  assert.equal(store.db.accounts['2'].suspended_at_estimated, true);
  assert.equal(store.db.accounts['1'].suspended, false);

  client.state.statuses['1'] = 'STATUS_DISABLE';
  client.state.statuses['2'] = 'STATUS_ENABLE';
  const r = await scanner.scanAccounts();
  assert.equal(r.newlySuspended, 1);
  assert.equal(store.db.accounts['1'].suspended_at_estimated, false);
  assert.ok(store.db.accounts['2'].reactivated_at);
});

test('collects rejected creatives, auto appeals once, resolves when approved', async () => {
  const { client, store, scanner } = setup();
  store.db.settings.autoAppeal = true;
  await scanner.fullScan();
  const c = store.db.creatives['11'];
  assert.equal(c.state, 'rejected');
  assert.equal(c.reject_reasons[0].reason, 'Misleading');
  assert.equal(client.state.appeals.length, 1);
  assert.deepEqual(client.state.appeals[0], { advertiser_id: '1', adgroup_id: '101', ad_id: '11', appeal_reason: store.db.settings.appealReason });

  c.appeal_status = undefined; // dù trạng thái không còn "đang appeal", vẫn không appeal quá maxAppealsPerAd
  await scanner.fullScan();
  assert.equal(client.state.appeals.length, 1);

  client.state.adStatus = 'AD_STATUS_DELIVERY_OK';
  await scanner.scanCreatives();
  assert.equal(store.db.creatives['11'].state, 'resolved');
});

test('rejects concurrent scans', async () => {
  const { scanner } = setup();
  const p = scanner.scanAccounts();
  await assert.rejects(scanner.scanAccounts(), /Đang chạy/);
  await p;
});
