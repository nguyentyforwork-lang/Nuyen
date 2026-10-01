// Deterministic demo data (used when TIKTOK_ACCESS_TOKEN is not set).
const { resolveRange, addDays, daysBetween } = require('./dates');

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const APPS = [
  { app_id: '7512046042569850881', app_name: 'Tricky Prank: Annoying Quest', platform: 'ANDROID' },
  { app_id: '7584398505481895944', app_name: 'Tricky Dramas: Short Stories', platform: 'ANDROID' },
  { app_id: '7600000000000000001', app_name: 'Merge Garden Puzzle', platform: 'IOS' },
  { app_id: '7600000000000000002', app_name: 'Idle Mining Tycoon', platform: 'ANDROID' },
  { app_id: '7600000000000000003', app_name: 'Block Blast Master', platform: 'ANDROID' },
];
const ACCOUNTS = [
  { advertiser_id: '7543462408405139473', name: 'HIGAME_Tricky Prank 02', timezone: 'Asia/Bangkok', currency: 'USD', apps: [0], bc_id: 'demo-bc-1' },
  { advertiser_id: '7584379549048176656', name: 'HIGAME_Tricky Dramas_AND', timezone: 'Asia/Bangkok', currency: 'USD', apps: [1], bc_id: 'demo-bc-1' },
  { advertiser_id: '7590000000000000001', name: 'Studio_Multi_App_01', timezone: 'America/Los_Angeles', currency: 'USD', apps: [2, 3, 4], bc_id: 'demo-bc-2' },
  { advertiser_id: '7590000000000000002', name: 'Studio_Merge_iOS', timezone: 'Asia/Tokyo', currency: 'USD', apps: [2], bc_id: 'demo-bc-2' },
  { advertiser_id: '7590000000000000003', name: 'Studio_Idle_VN', timezone: 'Asia/Ho_Chi_Minh', currency: 'VND', apps: [3, 4], bc_id: 'demo-bc-2' },
  { advertiser_id: '7590000000000000004', name: 'Studio_Block_EU', timezone: 'Europe/London', currency: 'USD', apps: [4, 1], bc_id: 'demo-bc-1' },
];
const GEOS = ['US', 'BR', 'ID', 'PH', 'TH', 'VN', 'MX', 'DE', 'JP', 'IN', 'TR', 'GB'];
const HOOKS = ['hang', 'fail', 'asmr', 'ugc', 'gameplay', 'meme', 'pov', 'tutorial'];

function mockBCs() {
  return [
    { bc_id: 'demo-bc-1', name: 'DEMO BC – HIGAME', timezone: 'Asia/Ho_Chi_Minh', currency: 'USD', status: 'ENABLE' },
    { bc_id: 'demo-bc-2', name: 'DEMO BC – Studio X', timezone: 'Asia/Ho_Chi_Minh', currency: 'USD', status: 'ENABLE' },
  ];
}

function mockOverview(bcIds, rangeReq, config) {
  const advertisers = ACCOUNTS.map((acc, ai) => ({ acc, ai })).filter(({ acc }) => bcIds.includes(acc.bc_id)).map(({ acc, ai }) => {
    const range = resolveRange(rangeReq, acc.timezone);
    const fx = config.fxToUsd[acc.currency] ?? 1;
    const r = rng(ai * 7919 + 17);
    const days = daysBetween(range.start, range.end) + 1;
    const apps = acc.apps.map((i) => ({ ...APPS[i], package_name: `com.demo.${i}`, icon: null, partner: 'AppsFlyer' }));
    const ads = [];
    const campaignDaily = [];
    const adgroupDaily = [];
    const geo = [];
    const adGeo = [];
    const campaigns = {};
    const adgroups = {};
    let cIdx = 0;
    for (const app of apps) {
      const nCamp = 2 + Math.floor(r() * 3);
      for (let c = 0; c < nCamp; c++) {
        const cid = `${acc.advertiser_id.slice(-4)}${String(++cIdx).padStart(4, '0')}`;
        const cname = `${app.app_name.split(':')[0]}_${['ROAS', 'AEO', 'VO', 'MAI'][c % 4]}_${GEOS[c % GEOS.length]}_${c + 1}`;
        const budget = [50, 100, 200, 300, 500][Math.floor(r() * 5)];
        const cbo = r() > 0.4;
        const roasBase = 0.35 + r() * 1.1;
        campaigns[cid] = { name: cname, budget: cbo ? budget : 0, budget_mode: cbo ? 'BUDGET_MODE_DAY' : 'BUDGET_MODE_INFINITE', daily: cbo, status: 'ENABLE' };
        const agid = `${cid}01`;
        adgroups[agid] = { name: `Ad group 1 - ${cname}`, campaign_id: cid, budget: cbo ? 0 : budget, budget_mode: cbo ? 'BUDGET_MODE_INFINITE' : 'BUDGET_MODE_DAY', daily: !cbo, status: 'ENABLE', app_id: app.app_id };
        let cSpend = 0, cRev = 0, cInst = 0;
        for (let d = 0; d < days; d++) {
          const date = addDays(range.start, d);
          const hit = r() > 0.7;
          const spend = hit ? budget * (0.97 + r() * 0.04) : budget * (0.2 + r() * 0.7);
          const rev = spend * roasBase * (0.7 + r() * 0.6);
          const inst = Math.round(spend / (0.08 + r() * 0.4));
          cSpend += spend; cRev += rev; cInst += inst;
          campaignDaily.push({ campaign_id: cid, campaign_name: cname, date, spend, rev });
          adgroupDaily.push({ adgroup_id: agid, adgroup_name: adgroups[agid].name, campaign_id: cid, date, spend });
        }
        const nAds = 3 + Math.floor(r() * 4);
        let w = Array.from({ length: nAds }, () => r() ** 2);
        const ws = w.reduce((a, b) => a + b, 0);
        w = w.map((x) => x / ws);
        w.forEach((share, k) => {
          const hook = HOOKS[Math.floor(r() * HOOKS.length)];
          const name = `${app.app_name.split(':')[0]}_${hook}_v${10 + Math.floor(r() * 50)}_9x16_${[15, 25, 35][k % 3]}s.mp4`;
          const spend = cSpend * share;
          const rev = cRev * share * (0.5 + r());
          const adId = `${agid}${k}`;
          ads.push({
            ad_id: adId, ad_name: name, adgroup_id: agid, adgroup_name: adgroups[agid].name,
            campaign_id: cid, campaign_name: cname, app_id: app.app_id, spend, rev,
          });
          const ag = GEOS.slice().sort(() => r() - 0.5).slice(0, 3);
          [0.6, 0.3, 0.1].forEach((x, j) => adGeo.push({ ad_id: adId, country: ag[j], spend: spend * x, rev: rev * x * (0.6 + r() * 0.8) }));
        });
        const g = GEOS.slice().sort(() => r() - 0.5).slice(0, 4);
        const gw = [0.5, 0.25, 0.15, 0.1];
        g.forEach((country, k) => geo.push({ campaign_id: cid, country, spend: cSpend * gw[k], rev: cRev * gw[k] * (0.6 + r() * 0.8) }));
      }
    }
    return { ...acc, display_timezone: acc.timezone, fx, range, apps, ads, campaignDaily, adgroupDaily, geo, adGeo, campaigns, adgroups };
  });
  return { bc_ids: bcIds, generated_at: new Date().toISOString(), demo: true, advertisers };
}

module.exports = { mockBCs, mockOverview };
