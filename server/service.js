// Pulls everything the dashboard needs for one Business Center.
// Each advertiser is queried with a date range resolved in its own time zone.
const { resolveRange } = require('./dates');

const DAILY_MODES = new Set(['BUDGET_MODE_DAY', 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET']);

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

function createService(client, config) {
  const REV = config.iaaRevenueMetric;

  async function listBCs() {
    const list = await client.getAll('/bc/get/', {}, 'list', 50);
    return list.map((x) => ({
      bc_id: x.bc_info.bc_id,
      name: x.bc_info.name,
      timezone: x.bc_info.timezone,
      currency: x.bc_info.currency,
      status: x.bc_info.status,
    }));
  }

  async function listAdvertisers(bcId) {
    const assets = await client.getAll(
      '/bc/asset/get/',
      { bc_id: bcId, asset_type: 'ADVERTISER' },
      'list',
      50,
    );
    const ids = assets.map((a) => a.asset_id);
    const infos = [];
    for (const ids100 of chunk(ids, 100)) {
      const data = await client.get('/advertiser/info/', {
        advertiser_ids: ids100,
        fields: ['advertiser_id', 'name', 'timezone', 'display_timezone', 'currency', 'status'],
      });
      infos.push(...(Array.isArray(data) ? data : data.list || []));
    }
    const byId = Object.fromEntries(infos.map((i) => [String(i.advertiser_id), i]));
    return assets.map((a) => {
      const info = byId[a.asset_id] || {};
      return {
        advertiser_id: a.asset_id,
        bc_id: bcId,
        name: info.name || a.asset_name,
        timezone: info.timezone || 'UTC',
        display_timezone: info.display_timezone || info.timezone || 'UTC',
        currency: info.currency || 'USD',
        status: info.status,
      };
    });
  }

  async function fetchAdvertiser(adv, rangeReq) {
    const range = resolveRange(rangeReq, adv.timezone);
    const fx = config.fxToUsd[adv.currency] ?? 1;
    const money = (v) => num(v) * fx;
    const base = {
      advertiser_id: adv.advertiser_id,
      start_date: range.start,
      end_date: range.end,
    };

    // Event Manager apps (App Management) of this ad account.
    const appsP = client
      .get('/app/list/', { advertiser_id: adv.advertiser_id })
      .then((d) =>
        (d.apps || []).map((a) => ({
          app_id: String(a.app_id),
          app_name: a.app_name,
          platform: a.platform,
          package_name: a.package_name || a.app_platform_id,
          icon: a.icon?.web_uri || null,
          download_url: a.download_url,
          partner: a.partner?.partner_name || null,
        })),
      );

    // Ad level: spend per creative + which app (tt_app_id) each ad promotes.
    const adsP = client.report(
      {
        ...base,
        data_level: 'AUCTION_AD',
        dimensions: ['ad_id'],
        metrics: [
          'spend', REV,
          'ad_name', 'adgroup_id', 'adgroup_name', 'campaign_id', 'campaign_name', 'tt_app_id',
        ],
        order_field: 'spend',
        order_type: 'DESC',
      },
      { stopWhenZeroSpend: true },
    );

    const campaignDailyP = client.report(
      {
        ...base,
        data_level: 'AUCTION_CAMPAIGN',
        dimensions: ['campaign_id', 'stat_time_day'],
        metrics: ['spend', REV, 'campaign_name'],
        order_field: 'spend',
        order_type: 'DESC',
      },
      { stopWhenZeroSpend: true },
    );

    const adgroupDailyP = client.report(
      {
        ...base,
        data_level: 'AUCTION_ADGROUP',
        dimensions: ['adgroup_id', 'stat_time_day'],
        metrics: ['spend', 'adgroup_name', 'campaign_id'],
        order_field: 'spend',
        order_type: 'DESC',
      },
      { stopWhenZeroSpend: true },
    );

    const geoP = client.report(
      {
        ...base,
        data_level: 'AUCTION_CAMPAIGN',
        dimensions: ['campaign_id', 'country_code'],
        metrics: ['spend', REV],
        order_field: 'spend',
        order_type: 'DESC',
      },
      { stopWhenZeroSpend: true },
    );

    // Ad x country: top geo at creative level.
    const adGeoP = client.report(
      {
        ...base,
        data_level: 'AUCTION_AD',
        dimensions: ['ad_id', 'country_code'],
        metrics: ['spend', REV],
        order_field: 'spend',
        order_type: 'DESC',
      },
      { stopWhenZeroSpend: true },
    );

    const [apps, ads, campaignDaily, adgroupDaily, geo, adGeo] = await Promise.all([
      appsP, adsP, campaignDailyP, adgroupDailyP, geoP, adGeoP,
    ]);

    // Current budgets for campaigns / ad groups that spent in range.
    const campaignIds = [...new Set(campaignDaily.map((r) => r.campaign_id))];
    const campaigns = {};
    const adgroups = {};
    for (const ids of chunk(campaignIds, 100)) {
      const [cs, ags] = await Promise.all([
        client.getAll('/campaign/get/', {
          advertiser_id: adv.advertiser_id,
          fields: ['campaign_id', 'campaign_name', 'budget', 'budget_mode', 'operation_status', 'secondary_status'],
          filtering: { campaign_ids: ids },
        }),
        client.getAll('/adgroup/get/', {
          advertiser_id: adv.advertiser_id,
          fields: ['adgroup_id', 'campaign_id', 'adgroup_name', 'budget', 'budget_mode', 'operation_status', 'app_id'],
          filtering: { campaign_ids: ids },
        }),
      ]);
      for (const c of cs) {
        campaigns[c.campaign_id] = {
          name: c.campaign_name,
          budget: money(c.budget),
          budget_mode: c.budget_mode,
          daily: DAILY_MODES.has(c.budget_mode) && num(c.budget) > 0,
          status: c.operation_status,
          secondary_status: c.secondary_status,
        };
      }
      for (const g of ags) {
        adgroups[g.adgroup_id] = {
          name: g.adgroup_name,
          campaign_id: g.campaign_id,
          budget: money(g.budget),
          budget_mode: g.budget_mode,
          daily: DAILY_MODES.has(g.budget_mode) && num(g.budget) > 0,
          status: g.operation_status,
          app_id: g.app_id ? String(g.app_id) : null,
        };
      }
    }

    return {
      ...adv,
      fx,
      range,
      apps,
      ads: ads.map((r) => ({
        ad_id: r.ad_id,
        ad_name: r.ad_name,
        adgroup_id: r.adgroup_id,
        adgroup_name: r.adgroup_name,
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        app_id: r.tt_app_id && r.tt_app_id !== '-' ? String(r.tt_app_id) : null,
        spend: money(r.spend),
        rev: money(r[REV]),
      })),
      campaignDaily: campaignDaily.map((r) => ({
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        date: String(r.stat_time_day).slice(0, 10),
        spend: money(r.spend),
        rev: money(r[REV]),
      })),
      adgroupDaily: adgroupDaily.map((r) => ({
        adgroup_id: r.adgroup_id,
        adgroup_name: r.adgroup_name,
        campaign_id: r.campaign_id,
        date: String(r.stat_time_day).slice(0, 10),
        spend: money(r.spend),
      })),
      geo: geo.map((r) => ({
        campaign_id: r.campaign_id,
        country: r.country_code,
        spend: money(r.spend),
        rev: money(r[REV]),
      })),
      adGeo: adGeo.map((r) => ({
        ad_id: r.ad_id,
        country: r.country_code,
        spend: money(r.spend),
        rev: money(r[REV]),
      })),
      campaigns,
      adgroups,
    };
  }

  // One or many BCs; an ad account shared by several BCs is counted once (first BC wins).
  async function overview(bcIds, rangeReq) {
    const lists = await pool(bcIds, 2, (id) => listAdvertisers(id));
    const seen = new Set();
    const advertisers = lists.flat().filter((a) => !seen.has(a.advertiser_id) && seen.add(a.advertiser_id));
    const results = await pool(advertisers, config.concurrency, async (adv) => {
      try {
        return await fetchAdvertiser(adv, rangeReq);
      } catch (e) {
        return { ...adv, error: e.message, apps: [], ads: [], campaignDaily: [], adgroupDaily: [], geo: [], adGeo: [], campaigns: {}, adgroups: {} };
      }
    });
    return { bc_ids: bcIds, generated_at: new Date().toISOString(), advertisers: results };
  }

  return { listBCs, listAdvertisers, overview };
}

module.exports = { createService, pool, chunk };
