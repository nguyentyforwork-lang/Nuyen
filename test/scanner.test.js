const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/store');
const { createScanner } = require('../src/scanner');
const { matchTemplate, render } = require('../src/templates');

// Account 1 đang chạy (ad 11 bị từ chối), account 2 bị suspend (ad bị che bởi ADVERTISER_ACCOUNT_PUNISH)
function fakeClient() {
  const state = { statuses: { '1': 'STATUS_ENABLE', '2': 'STATUS_LIMIT' }, adStatus: 'AD_STATUS_AUDIT_DENY', approved: new Set(['22']), appeals: [] };
  return {
    state,
    async listAuthorizedAdvertisers() { return [{ advertiser_id: '1', name: 'A' }, { advertiser_id: '2', name: 'B' }]; },
    async listBcAdvertisers() { return []; },
    async getAdvertiserInfo(ids) { return ids.map((id) => ({ advertiser_id: id, name: id, status: state.statuses[id] })); },
    async getAds(adv) {
      if (adv === '1') return [{ ad_id: '11', adgroup_id: '101', campaign_id: '1001', ad_name: 'ad11', secondary_status: state.adStatus }];
      return ['21', '22'].map((id) => ({ ad_id: id, adgroup_id: '20' + id, campaign_id: '2000', ad_name: 'ad' + id, secondary_status: 'ADVERTISER_ACCOUNT_PUNISH' }));
    },
    async getAdReviewInfo(adv, ids) {
      return Object.fromEntries(ids.map((id) => [id, { is_approved: state.approved.has(id), reject_info: state.approved.has(id) ? [] : [{ reason: id === '21' ? 'Landing page is not functional' : 'Misleading claims' }] }]));
    },
    async appealAdgroup(p) { state.appeals.push(p); return {}; },
  };
}

function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nuyen-')), 'db.json');
  const client = fakeClient();
  const store = createStore(file);
  return { client, store, scanner: createScanner({ client, store, env: {}, log: { info() {} }, appealDelayMs: 0 }) };
}

const waitJob = async (scanner) => { while (scanner.job.status === 'running') await new Promise((r) => setTimeout(r, 5)); return scanner.job; };

test('tracks suspension date and estimated flag', async () => {
  const { client, store, scanner } = setup();
  await scanner.scanAccounts();
  assert.equal(store.db.accounts['2'].suspended, true);
  assert.equal(store.db.accounts['2'].suspended_at_estimated, true);

  client.state.statuses['1'] = 'STATUS_DISABLE';
  client.state.statuses['2'] = 'STATUS_ENABLE';
  const r = await scanner.scanAccounts();
  assert.equal(r.newlySuspended, 1);
  assert.equal(store.db.accounts['1'].suspended_at_estimated, false);
  assert.ok(store.db.accounts['2'].reactivated_at);
});

test('suspended account: deep check finds violating ads hidden behind ACCOUNT_PUNISH', async () => {
  const { store, scanner } = setup();
  await scanner.scanAccounts();
  await scanner.scanCreatives({ advertiserIds: ['2'] });
  assert.equal(store.db.creatives['21'].state, 'rejected');
  assert.equal(store.db.creatives['22'], undefined); // ad đã được duyệt thì bỏ qua
  assert.ok(store.db.accounts['2'].creatives_checked_at);
});

test('bulk appeal across accounts uses default template, matches keyword templates, skips appealed ads', async () => {
  const { client, store, scanner } = setup();
  store.db.templates.push({ id: 'tpl-landing', kind: 'creative', name: 'Landing', keywords: ['landing page'], text: 'LP {ad_name}: {reason}' });
  await scanner.fullScan();
  const plan = scanner.buildAppealPlan({ advertiserIds: ['1', '2'] });
  assert.equal(plan.items.length, 2);
  assert.equal(plan.accounts, 2);
  assert.equal(plan.items.find((i) => i.ad_id === '21').reason, 'LP ad21: Landing page is not functional');
  const def = plan.items.find((i) => i.ad_id === '11');
  assert.equal(def.template_id, 'creative-default');
  assert.match(def.reason, /^My campaign was wrongly flag/);

  scanner.startAppealJob({ advertiserIds: ['1', '2'] });
  const job = await waitJob(scanner);
  assert.equal(job.ok, 2);
  assert.deepEqual(client.state.appeals.map((a) => a.ad_id).sort(), ['11', '21']);

  // Lần 2: đã appeal => bị bỏ qua
  assert.equal(scanner.buildAppealPlan({ advertiserIds: ['1', '2'] }).items.length, 0);
  assert.equal(scanner.buildAppealPlan({ advertiserIds: ['1', '2'], skipAppealed: false }).items.length, 2);
  assert.throws(() => scanner.startAppealJob({ advertiserIds: ['1'] }), /Không có creative/);
});

test('update status of selected accounts only: suspended -> lifted', async () => {
  const { client, store, scanner } = setup();
  await scanner.scanAccounts();
  client.state.statuses['2'] = 'STATUS_ENABLE';
  const r = await scanner.scanAccounts({ advertiserIds: ['2'] });
  assert.equal(r.total, 1);
  assert.equal(store.db.accounts['2'].suspended, false);
  assert.ok(store.db.accounts['2'].reactivated_at);
  assert.ok(store.db.accounts['2'].suspended_at); // vẫn giữ ngày suspend để hiện tiến trình
});

test('migrates old built-in templates to the new defaults, keeps user templates', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nuyen-')), 'db.json');
  fs.writeFileSync(file, JSON.stringify({ settings: { defaultTemplateId: 'creative-landing' }, templates: [
    { id: 'creative-default', kind: 'creative', name: 'old', keywords: [], text: 'old' },
    { id: 'creative-landing', kind: 'creative', name: 'old lp', keywords: ['landing'], text: 'old' },
    { id: 'tpl-mine', kind: 'creative', name: 'mine', keywords: [], text: 'mine' },
  ] }));
  const { db } = createStore(file);
  assert.deepEqual(db.templates.map((t) => t.id), ['creative-default', 'account-default', 'tpl-mine']);
  assert.match(db.templates[0].text, /^My campaign was wrongly flag/);
  assert.match(db.templates[1].text, /^My account was suspended/);
  assert.equal(db.settings.defaultTemplateId, 'creative-default');
});

test('custom text and fixed template', async () => {
  const { scanner } = setup();
  await scanner.fullScan();
  const custom = scanner.buildAppealPlan({ adIds: ['11'], text: 'Please re-review {ad_id}' });
  assert.equal(custom.items[0].reason, 'Please re-review 11');
  const fixed = scanner.buildAppealPlan({ adIds: ['11'], templateId: 'creative-default' });
  assert.equal(fixed.items[0].template_id, 'creative-default');
});

test('auto appeal respects scope and max per ad; resolves when approved', async () => {
  const { client, store, scanner } = setup();
  store.db.settings.autoAppeal = true;
  store.db.settings.autoAppealScope = 'active';
  await scanner.fullScan();
  assert.deepEqual(client.state.appeals.map((a) => a.ad_id), ['11']);
  store.db.creatives['11'].appeal_status = undefined;
  await scanner.fullScan();
  assert.equal(client.state.appeals.length, 1);

  client.state.adStatus = 'AD_STATUS_DELIVERY_OK';
  await scanner.scanCreatives({ advertiserIds: ['1'] });
  assert.equal(store.db.creatives['11'].state, 'resolved');
});

test('template matching and rendering', () => {
  const { DEFAULT_TEMPLATES } = require('../src/templates');
  const tpls = [...DEFAULT_TEMPLATES, { id: 'x', kind: 'creative', keywords: ['unrealistic'], text: '' }];
  assert.equal(matchTemplate(tpls, ['Unrealistic results']).id, 'x');
  assert.equal(matchTemplate(tpls, ['something else']).id, 'creative-default');
  assert.equal(render('{a}-{reason}', { a: 'x' }), 'x-policy violation');
});

test('rejects concurrent work', async () => {
  const { scanner } = setup();
  const p = scanner.scanAccounts();
  await assert.rejects(scanner.scanAccounts(), /Đang chạy/);
  await p;
});
