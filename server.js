// Creative Spend Viewer — TikTok Ads
// Zero-dependency Node server (Node >= 18). Proxies TikTok Marketing API so the
// access token stays server-side and the browser avoids CORS.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const API_BASE = process.env.TIKTOK_API_BASE || 'https://business-api.tiktok.com/open_api/v1.3';
const ENV_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

const REPORT_METRICS = [
  'spend', 'impressions', 'clicks', 'conversion', 'complete_payment',
  'complete_payment_roas', 'video_play_actions',
  'ad_name', 'campaign_name', 'adgroup_name', 'campaign_id', 'adgroup_id',
];

const AD_FIELDS = [
  'ad_id', 'ad_name', 'campaign_id', 'campaign_name', 'adgroup_id', 'adgroup_name',
  'video_id', 'image_ids', 'tiktok_item_id', 'identity_type', 'ad_format', 'ad_text',
  'operation_status', 'secondary_status', 'create_time',
];

// ---------------------------------------------------------------------------
// TikTok API helpers
// ---------------------------------------------------------------------------

async function tiktokGet(endpoint, params, token) {
  const url = new URL(API_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const res = await fetch(url, { headers: { 'Access-Token': token } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch {
    throw new Error(`TikTok API ${endpoint} trả về dữ liệu không hợp lệ (HTTP ${res.status})`);
  }
  if (body.code !== 0) {
    throw new Error(`TikTok API ${endpoint}: ${body.message || 'lỗi'} (code ${body.code})`);
  }
  return body.data || {};
}

async function getAllPages(endpoint, params, token) {
  const out = [];
  let page = 1;
  for (;;) {
    const data = await tiktokGet(endpoint, { ...params, page, page_size: 1000 }, token);
    out.push(...(data.list || []));
    const totalPage = data.page_info?.total_page || 1;
    if (page >= totalPage) break;
    page++;
  }
  return out;
}

// Split [start, end] into windows of at most 365 days (API limit w/o stat_time_day).
function dateWindows(start, end, maxDays = 365) {
  const out = [];
  let cur = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (cur <= last) {
    const winEnd = new Date(cur);
    winEnd.setUTCDate(winEnd.getUTCDate() + maxDays - 1);
    const e = winEnd < last ? winEnd : last;
    out.push([iso(cur), iso(e)]);
    cur = new Date(e);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}
const iso = (d) => d.toISOString().slice(0, 10);

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function fetchCreatives({ advertiserId, startDate, endDate, includeDeleted, token }) {
  // 1) Account info (name / currency / timezone) — non-fatal.
  let advertiser = { advertiser_id: advertiserId };
  try {
    const info = await tiktokGet('/advertiser/info/', {
      advertiser_ids: [advertiserId],
      fields: ['advertiser_id', 'name', 'currency', 'timezone', 'display_timezone'],
    }, token);
    if (info.list?.[0]) advertiser = info.list[0];
  } catch (e) { advertiser.warning = e.message; }

  // 2) All ads in the account (spending or not).
  const adCalls = [getAllPages('/ad/get/', { advertiser_id: advertiserId, fields: AD_FIELDS }, token)];
  if (includeDeleted) {
    adCalls.push(getAllPages('/ad/get/', {
      advertiser_id: advertiserId, fields: AD_FIELDS, filtering: { primary_status: 'STATUS_DELETE' },
    }, token));
  }
  const adLists = await Promise.all(adCalls);
  const ads = new Map();
  for (const list of adLists) for (const ad of list) ads.set(String(ad.ad_id), ad);

  // 3) Ad-level spend for the date range (includes deleted ads that spent).
  const stats = new Map();
  for (const [s, e] of dateWindows(startDate, endDate)) {
    const rows = await getAllPages('/report/integrated/get/', {
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      data_level: 'AUCTION_AD',
      dimensions: ['ad_id'],
      metrics: REPORT_METRICS,
      start_date: s,
      end_date: e,
      filtering: [{ field_name: 'ad_status', filter_type: 'IN', filter_value: '["STATUS_ALL"]' }],
    }, token);
    for (const row of rows) {
      const id = String(row.dimensions.ad_id);
      const m = row.metrics || {};
      const cur = stats.get(id) || { spend: 0, impressions: 0, clicks: 0, conversion: 0, purchases: 0, revenue: 0, video_views: 0 };
      const spend = num(m.spend);
      cur.spend += spend;
      cur.impressions += num(m.impressions);
      cur.clicks += num(m.clicks);
      cur.conversion += num(m.conversion);
      cur.purchases += num(m.complete_payment);
      cur.revenue += num(m.complete_payment_roas) * spend;
      cur.video_views += num(m.video_play_actions);
      cur.attr = {
        ad_name: m.ad_name, campaign_name: m.campaign_name, adgroup_name: m.adgroup_name,
        campaign_id: m.campaign_id, adgroup_id: m.adgroup_id,
      };
      stats.set(id, cur);
    }
  }

  // Ads that spent but weren't returned by /ad/get/ (e.g. deleted) — keep them.
  for (const [id, st] of stats) {
    if (!ads.has(id)) ads.set(id, { ad_id: id, ...st.attr, operation_status: 'DELETED?', _fromReport: true });
  }

  // 4) Thumbnails for videos / images.
  const videoIds = [...new Set([...ads.values()].map((a) => a.video_id).filter(Boolean))];
  const imageIds = [...new Set([...ads.values()].flatMap((a) => a.image_ids || []).filter(Boolean))];
  const videos = {};
  const images = {};
  try {
    for (const ids of chunk(videoIds, 60)) {
      const d = await tiktokGet('/file/video/ad/info/', { advertiser_id: advertiserId, video_ids: ids }, token);
      for (const v of d.list || []) {
        videos[v.video_id] = { cover: v.video_cover_url || v.poster_url, preview: v.preview_url, file_name: v.file_name, duration: v.duration };
      }
    }
    for (const ids of chunk(imageIds, 100)) {
      const d = await tiktokGet('/file/image/ad/info/', { advertiser_id: advertiserId, image_ids: ids }, token);
      for (const im of d.list || []) images[im.image_id] = { url: im.image_url, file_name: im.file_name };
    }
  } catch (e) { advertiser.thumbWarning = e.message; }

  const result = [...ads.values()].map((ad) => {
    const st = stats.get(String(ad.ad_id)) || {};
    const v = ad.video_id ? videos[ad.video_id] : null;
    const img = ad.image_ids?.[0] ? images[ad.image_ids[0]] : null;
    return {
      ad_id: String(ad.ad_id),
      ad_name: ad.ad_name || st.attr?.ad_name || '',
      campaign_id: ad.campaign_id || st.attr?.campaign_id || '',
      campaign_name: ad.campaign_name || st.attr?.campaign_name || '',
      adgroup_id: ad.adgroup_id || st.attr?.adgroup_id || '',
      adgroup_name: ad.adgroup_name || st.attr?.adgroup_name || '',
      status: ad.operation_status || '',
      secondary_status: ad.secondary_status || '',
      create_time: ad.create_time || '',
      ad_text: ad.ad_text || '',
      video_id: ad.video_id || '',
      tiktok_item_id: ad.tiktok_item_id || '',
      image_id: ad.image_ids?.[0] || '',
      creative_name: v?.file_name || img?.file_name || '',
      thumbnail: v?.cover || img?.url || '',
      preview_url: v?.preview || '',
      spend: st.spend || 0,
      impressions: st.impressions || 0,
      clicks: st.clicks || 0,
      conversion: st.conversion || 0,
      purchases: st.purchases || 0,
      revenue: st.revenue || 0,
      video_views: st.video_views || 0,
    };
  });

  return { advertiser, start_date: startDate, end_date: endDate, ads: result };
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------------------
// Demo data (advertiser_id = "demo") — for trying the UI without a token.
// ---------------------------------------------------------------------------
function demoData(startDate, endDate) {
  const days = Math.max(1, (new Date(endDate) - new Date(startDate)) / 864e5 + 1);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const hooks = ['UGC Review', 'Unboxing', 'Before-After', 'Problem-Solution', 'Founder Story', 'Testimonial', 'Flash Sale', 'How-to', 'Trend Remix', 'Comparison'];
  const camps = ['[CBO] Prospecting US', '[ABO] Testing Creative', '[Retarget] 30D Visitors'];
  const ads = [];
  for (let i = 0; i < 36; i++) {
    const spending = rnd() > 0.35;
    const spend = spending ? Math.round(rnd() * 120 * days * 100) / 100 : 0;
    const impressions = Math.round(spend * (60 + rnd() * 80));
    const clicks = Math.round(impressions * (0.005 + rnd() * 0.02));
    const conv = Math.round(clicks * (0.01 + rnd() * 0.06));
    const hue = Math.round(rnd() * 360);
    ads.push({
      ad_id: String(1800000000000000 + i * 7919),
      ad_name: `${hooks[i % hooks.length]} v${1 + Math.floor(i / hooks.length)}`,
      campaign_id: String(1700000000000000 + (i % 3)),
      campaign_name: camps[i % 3],
      adgroup_id: String(1750000000000000 + (i % 6)),
      adgroup_name: `Adgroup ${1 + (i % 6)}`,
      status: spending ? 'ENABLE' : (rnd() > 0.5 ? 'DISABLE' : 'ENABLE'),
      secondary_status: '',
      create_time: '2026-0' + (1 + (i % 9)) + '-1' + (i % 9) + ' 10:00:00',
      ad_text: 'Demo ad text',
      video_id: 'v10033g50000demo' + i,
      tiktok_item_id: '',
      image_id: '',
      creative_name: `${hooks[i % hooks.length].toLowerCase().replace(/ /g, '_')}_${i}.mp4`,
      thumbnail: `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="hsl(${hue},45%,55%)"/><text x="45" y="85" font-size="22" text-anchor="middle" fill="white" font-family="sans-serif">#${i + 1}</text></svg>`)}`,
      preview_url: '',
      spend, impressions, clicks, conversion: conv,
      purchases: conv, revenue: conv * (25 + rnd() * 30), video_views: Math.round(impressions * 0.6),
    });
  }
  return {
    advertiser: { advertiser_id: 'demo', name: 'Demo Account', currency: 'USD', timezone: 'Etc/GMT+7' },
    start_date: startDate, end_date: endDate, ads, demo: true,
  };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/config') {
      return json(res, 200, { hasServerToken: Boolean(ENV_TOKEN) });
    }
    if (url.pathname === '/api/creatives') {
      const advertiserId = (url.searchParams.get('advertiser_id') || '').trim();
      const startDate = url.searchParams.get('start_date');
      const endDate = url.searchParams.get('end_date');
      const includeDeleted = url.searchParams.get('include_deleted') === '1';
      if (!advertiserId) return json(res, 400, { error: 'Thiếu Ad Account ID' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '') || startDate > endDate) {
        return json(res, 400, { error: 'Khoảng ngày không hợp lệ' });
      }
      if (advertiserId.toLowerCase() === 'demo') return json(res, 200, demoData(startDate, endDate));
      if (!/^\d+$/.test(advertiserId)) return json(res, 400, { error: 'Ad Account ID chỉ gồm chữ số' });
      const token = req.headers['x-access-token'] || ENV_TOKEN;
      if (!token) return json(res, 400, { error: 'Chưa có Access Token. Đặt TIKTOK_ACCESS_TOKEN trong .env hoặc nhập ở phần Cài đặt.' });
      const data = await fetchCreatives({ advertiserId, startDate, endDate, includeDeleted, token });
      return json(res, 200, data);
    }
    // Static files
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    json(res, 502, { error: e.message || 'Lỗi không xác định' });
  }
});

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

if (require.main === module) {
  server.listen(PORT, () => console.log(`Creative Spend Viewer: http://localhost:${PORT}`));
}

module.exports = { dateWindows, fetchCreatives };
