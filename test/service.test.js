const test = require('node:test');
const assert = require('node:assert');
const { resolveRange, todayIn } = require('../server/dates');
const { createService } = require('../server/service');

test('ranges resolve in the ad account time zone', () => {
  const now = new Date('2026-10-01T18:30:00Z'); // already Oct 2 in Tokyo, still Oct 1 in LA
  assert.strictEqual(todayIn('Asia/Tokyo', now), '2026-10-02');
  assert.strictEqual(todayIn('America/Los_Angeles', now), '2026-10-01');
  assert.deepStrictEqual(resolveRange({ preset: 'yesterday' }, 'Asia/Tokyo', now), { start: '2026-10-01', end: '2026-10-01' });
  assert.deepStrictEqual(resolveRange({ preset: 'last3' }, 'America/Los_Angeles', now), { start: '2026-09-28', end: '2026-09-30' });
  assert.deepStrictEqual(resolveRange({ preset: 'last3', includeToday: true }, 'America/Los_Angeles', now), { start: '2026-09-29', end: '2026-10-01' });
  assert.deepStrictEqual(resolveRange({ preset: 'last7' }, 'Asia/Bangkok', now), { start: '2026-09-25', end: '2026-10-01' }); // Bangkok is already Oct 2
});

test('service maps ads to apps, converts currency and pulls budgets', async () => {
  const calls = [];
  const client = {
    async get(path, params) {
      calls.push([path, params]);
      if (path === '/advertiser/info/') return { list: [{ advertiser_id: '1', name: 'Acc VND', timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' }] };
      if (path === '/app/list/') return { apps: [{ app_id: '99', app_name: 'Game', platform: 'ANDROID' }] };
      throw new Error('unexpected ' + path);
    },
    async getAll(path) {
      if (path === '/bc/asset/get/') return [{ asset_id: '1', asset_name: 'Acc VND' }];
      if (path === '/campaign/get/') return [{ campaign_id: 'c1', campaign_name: 'C1', budget: 1000000, budget_mode: 'BUDGET_MODE_DAY', operation_status: 'ENABLE' }];
      if (path === '/adgroup/get/') return [{ adgroup_id: 'g1', campaign_id: 'c1', budget: 0, budget_mode: 'BUDGET_MODE_INFINITE', app_id: '99' }];
      return [];
    },
    async report(params) {
      calls.push(['report', params]);
      if (params.data_level === 'AUCTION_AD') return [{ ad_id: 'a1', ad_name: 'v1.mp4', campaign_id: 'c1', adgroup_id: 'g1', tt_app_id: '99', spend: '1000000', total_in_app_ad_impr_value: '500000', app_install: '10' }];
      if (params.data_level === 'AUCTION_CAMPAIGN' && params.dimensions.includes('stat_time_day')) return [{ campaign_id: 'c1', stat_time_day: '2026-10-01 00:00:00', spend: '1000000', total_in_app_ad_impr_value: '500000' }];
      return [];
    },
  };
  const svc = createService(client, { iaaRevenueMetric: 'total_in_app_ad_impr_value', fxToUsd: { VND: 0.00004 }, concurrency: 2 });
  const out = await svc.overview('bc', { preset: 'today' });
  const adv = out.advertisers[0];
  assert.ifError(adv.error);
  assert.strictEqual(adv.ads[0].app_id, '99');
  assert.strictEqual(adv.ads[0].spend, 40);
  assert.strictEqual(adv.ads[0].rev, 20);
  assert.strictEqual(adv.campaignDaily[0].date, '2026-10-01');
  assert.strictEqual(adv.campaigns.c1.budget, 40);
  assert.strictEqual(adv.campaigns.c1.daily, true);
  const rep = calls.find((c) => c[0] === 'report');
  assert.strictEqual(rep[1].start_date, todayIn('Asia/Ho_Chi_Minh'));
});
