const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadEnv } = require('./src/env');

loadEnv();

const { createClient } = require('./src/tiktok');
const { createMockClient } = require('./src/mock');
const { createStore } = require('./src/store');
const { createScanner, SUSPENDED } = require('./src/scanner');

const MOCK = process.env.MOCK === '1';
const TZ = process.env.TZ_DISPLAY || 'Asia/Ho_Chi_Minh';
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

const client = MOCK
  ? createMockClient()
  : createClient({ accessToken: process.env.TIKTOK_ACCESS_TOKEN, appId: process.env.TIKTOK_APP_ID, secret: process.env.TIKTOK_SECRET });
const store = createStore(process.env.DB_FILE || (MOCK ? path.join(__dirname, 'data', 'mock-db.json') : undefined));
const scanner = createScanner({ client, store });

// Ngày (YYYY-MM-DD) theo múi giờ hiển thị
const localDate = (iso) => (iso ? new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ }) : '');
const inRange = (iso, from, to) => {
  const d = localDate(iso);
  return !!d && (!from || d >= from) && (!to || d <= to);
};

function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [columns.map((c) => c[0]).join(','), ...rows.map((r) => columns.map((c) => esc(c[1](r))).join(','))].join('\n');
}

function queryAccounts(q) {
  let rows = Object.values(store.db.accounts);
  const view = q.get('view') || 'suspended';
  const from = q.get('from'), to = q.get('to');
  if (view === 'suspended') rows = rows.filter((a) => a.suspended_at && (from || to ? inRange(a.suspended_at, from, to) : a.suspended));
  if (view === 'current') rows = rows.filter((a) => a.suspended);
  const kw = (q.get('q') || '').toLowerCase();
  if (kw) rows = rows.filter((a) => `${a.advertiser_id} ${a.name} ${a.company}`.toLowerCase().includes(kw));
  return rows.sort((a, b) => (b.suspended_at || '').localeCompare(a.suspended_at || ''));
}

function queryCreatives(q) {
  let rows = Object.values(store.db.creatives);
  const state = q.get('state') || 'rejected';
  if (state !== 'all') rows = rows.filter((c) => c.state === state);
  const from = q.get('from'), to = q.get('to');
  if (from || to) rows = rows.filter((c) => inRange(c.detected_at, from, to));
  const adv = q.get('advertiser_id');
  if (adv) rows = rows.filter((c) => c.advertiser_id === adv);
  const appeal = q.get('appeal');
  if (appeal === 'none') rows = rows.filter((c) => !(c.appeals || []).some((a) => a.ok));
  if (appeal === 'done') rows = rows.filter((c) => (c.appeals || []).some((a) => a.ok));
  const kw = (q.get('q') || '').toLowerCase();
  if (kw) rows = rows.filter((c) => `${c.ad_id} ${c.ad_name} ${c.advertiser_name} ${c.campaign_name} ${(c.reject_reasons || []).map((r) => r.reason).join(' ')}`.toLowerCase().includes(kw));
  return rows.sort((a, b) => (b.detected_at || '').localeCompare(a.detected_at || ''));
}

// ===== Lịch quét tự động =====
let timer = null;
let nextRunAt = null;
function schedule() {
  clearTimeout(timer);
  const { autoScan, scanIntervalMinutes } = store.db.settings;
  if (!autoScan) { nextRunAt = null; return; }
  const ms = Math.max(5, Number(scanIntervalMinutes) || 60) * 60000;
  nextRunAt = new Date(Date.now() + ms).toISOString();
  timer = setTimeout(async () => {
    try { await scanner.fullScan(); } catch (err) { console.error('[scan] lỗi:', err.message); }
    schedule();
  }, ms);
}

// ===== HTTP =====
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...extra });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(Object.assign(e, { status: 400 })); } });
    req.on('error', reject);
  });
}

function authorized(req) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return true;
  const m = (req.headers.authorization || '').match(/^Basic (.+)$/);
  if (!m) return false;
  const given = Buffer.from(Buffer.from(m[1], 'base64').toString().split(':').slice(1).join(':'));
  const expected = Buffer.from(pw);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const routes = {
  'GET /api/status': () => ({
    mock: MOCK,
    configured: MOCK || !!process.env.TIKTOK_ACCESS_TOKEN,
    running: scanner.running,
    nextRunAt,
    tz: TZ,
    counts: {
      accounts: Object.keys(store.db.accounts).length,
      suspended: Object.values(store.db.accounts).filter((a) => a.suspended).length,
      rejected: Object.values(store.db.creatives).filter((c) => c.state === 'rejected').length,
      pendingAutoAppeal: scanner.autoAppealCandidates().length,
    },
    lastScans: store.db.scans.slice(0, 10),
    suspendedStatuses: [...SUSPENDED],
  }),
  'GET /api/accounts': (req, q) => queryAccounts(q),
  'GET /api/creatives': (req, q) => queryCreatives(q),
  'GET /api/appeal-log': () => store.db.appealLog.slice(0, 500),
  'GET /api/settings': () => store.db.settings,
  'POST /api/settings': async (req) => {
    const body = await readBody(req);
    const s = store.db.settings;
    if ('autoScan' in body) s.autoScan = !!body.autoScan;
    if ('autoAppeal' in body) s.autoAppeal = !!body.autoAppeal;
    if ('scanIntervalMinutes' in body) s.scanIntervalMinutes = Math.max(5, Number(body.scanIntervalMinutes) || 60);
    if ('maxAppealsPerRun' in body) s.maxAppealsPerRun = Math.max(1, Number(body.maxAppealsPerRun) || 50);
    if ('maxAppealsPerAd' in body) s.maxAppealsPerAd = Math.max(1, Number(body.maxAppealsPerAd) || 1);
    if (typeof body.appealReason === 'string' && body.appealReason.trim()) s.appealReason = body.appealReason.trim().slice(0, 1000);
    store.save();
    schedule();
    return s;
  },
  'POST /api/scan/accounts': () => scanner.scanAccounts(),
  'POST /api/scan/creatives': async (req) => scanner.scanCreatives({ advertiserIds: (await readBody(req)).advertiser_ids }),
  'POST /api/scan/full': () => scanner.fullScan(),
  'POST /api/appeal': async (req) => {
    const body = await readBody(req);
    if (!Array.isArray(body.ad_ids) || !body.ad_ids.length) throw Object.assign(new Error('Chưa chọn creative'), { status: 400 });
    return scanner.appeal(body.ad_ids.map(String), { reason: body.reason });
  },
  'GET /api/export/accounts.csv': (req, q) => ({
    csv: toCsv(queryAccounts(q), [
      ['Advertiser ID', (a) => a.advertiser_id], ['Tên', (a) => a.name], ['Công ty', (a) => a.company],
      ['Trạng thái', (a) => a.status], ['Lý do', (a) => a.rejection_reason],
      ['Ngày suspend', (a) => localDate(a.suspended_at)], ['Ước lượng', (a) => (a.suspended_at_estimated ? 'có' : '')],
      ['Mở lại', (a) => localDate(a.reactivated_at)], ['Số dư', (a) => a.balance], ['Tiền tệ', (a) => a.currency], ['BC', (a) => a.owner_bc_id],
    ]),
    name: 'suspended-accounts.csv',
  }),
  'GET /api/export/creatives.csv': (req, q) => ({
    csv: toCsv(queryCreatives(q), [
      ['Ad ID', (c) => c.ad_id], ['Tên ad', (c) => c.ad_name], ['Advertiser ID', (c) => c.advertiser_id], ['Account', (c) => c.advertiser_name],
      ['Campaign', (c) => c.campaign_name], ['Adgroup ID', (c) => c.adgroup_id], ['Trạng thái', (c) => c.secondary_status],
      ['Lý do vi phạm', (c) => (c.reject_reasons || []).map((r) => r.reason).join(' | ')],
      ['Ngày phát hiện', (c) => localDate(c.detected_at)], ['Appeal', (c) => c.appeal_status || ''], ['Số lần appeal', (c) => (c.appeals || []).filter((a) => a.ok).length],
    ]),
    name: 'rejected-creatives.csv',
  }),
};

const server = http.createServer(async (req, res) => {
  if (!authorized(req)) return send(res, 401, 'Unauthorized', 'text/plain', { 'WWW-Authenticate': 'Basic realm="Nuyen"' });
  const url = new URL(req.url, 'http://localhost');
  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) {
    try {
      const out = await handler(req, url.searchParams);
      if (out && out.csv !== undefined) return send(res, 200, out.csv, 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="${out.name}"` });
      return send(res, 200, out);
    } catch (err) {
      console.error(err);
      return send(res, err.status || 500, { error: err.message });
    }
  }
  if (req.method !== 'GET') return send(res, 404, { error: 'Not found' });
  const file = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Nuyen đang chạy tại http://localhost:${PORT}${MOCK ? ' (MOCK – dữ liệu giả)' : ''}`);
    if (!MOCK && !process.env.TIKTOK_ACCESS_TOKEN) console.warn('⚠ Chưa có TIKTOK_ACCESS_TOKEN trong .env');
    schedule();
  });
}

module.exports = { server };
