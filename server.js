// Minimal server (no dependencies): serves the UI and proxies TikTok Business API
// calls so the browser does not hit CORS and the access token can stay server-side.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_BASE = process.env.TIKTOK_API_BASE || 'https://business-api.tiktok.com/open_api/v1.3';
const ENV_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const BATCH = 100; // advertiser/info accepts up to 100 ids per call

// ---------- status history (used to record the date an account is seen un-suspended) ----------
function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return {}; }
}
function saveHistory(h) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h));
}

// ---------- TikTok API ----------
async function tiktokGet(endpoint, params, token) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    qs.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const res = await fetch(`${API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': token } });
  const body = await res.json().catch(() => ({ code: res.status, message: `HTTP ${res.status}` }));
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch advertiser info for a batch. If the token lacks permission for some ids
// (code 40001 lists them in the message), drop those and retry the rest.
async function fetchAdvertiserBatch(ids, token, out) {
  let pending = [...ids];
  for (let attempt = 0; attempt < 5 && pending.length; attempt++) {
    const body = await tiktokGet('/advertiser/info/', {
      advertiser_ids: pending,
      fields: ['advertiser_id', 'name', 'status', 'owner_bc_id', 'company', 'create_time', 'country'],
    }, token);

    if (body.code === 0) {
      const got = new Set();
      for (const a of body.data?.list || []) {
        got.add(String(a.advertiser_id));
        out[String(a.advertiser_id)] = {
          name: a.name || '',
          status: a.status || '',
          owner_bc_id: a.owner_bc_id ? String(a.owner_bc_id) : '',
          company: a.company || '',
          country: a.country || '',
        };
      }
      for (const id of pending) if (!got.has(id)) out[id] = { error: 'Không tìm thấy' };
      return;
    }

    if (body.code === 40100 || body.code === 40133) { // rate limited
      await sleep(1500 * (attempt + 1));
      continue;
    }

    const noPerm = (body.message || '').match(/\d{15,20}/g);
    if (body.code === 40001 && noPerm) {
      const bad = new Set(noPerm);
      for (const id of pending) if (bad.has(id)) out[id] = { error: 'Token không có quyền với account này' };
      pending = pending.filter((id) => !bad.has(id));
      continue;
    }

    for (const id of pending) out[id] = { error: `${body.code}: ${body.message}` };
    return;
  }
  for (const id of pending) if (!out[id]) out[id] = { error: 'Hết lượt thử lại' };
}

async function fetchBcNames(bcIds, token) {
  const names = {};
  for (const bcId of bcIds) {
    const body = await tiktokGet('/bc/get/', { bc_id: bcId }, token);
    const info = body.code === 0 ? body.data?.list?.[0]?.bc_info : null;
    names[bcId] = info?.name || '';
  }
  return names;
}

async function lookup(ids, token) {
  const out = {};
  for (let i = 0; i < ids.length; i += BATCH) {
    await fetchAdvertiserBatch(ids.slice(i, i + BATCH), token, out);
  }

  const bcIds = [...new Set(Object.values(out).map((r) => r.owner_bc_id).filter(Boolean))];
  const bcNames = await fetchBcNames(bcIds, token);

  const history = loadHistory();
  const today = new Date().toISOString().slice(0, 10);
  for (const [id, r] of Object.entries(out)) {
    if (r.owner_bc_id) r.bc_name = bcNames[r.owner_bc_id] || '';
    if (!r.status) continue;
    const h = history[id] || {};
    const suspended = r.status === 'STATUS_LIMIT';
    if (suspended) {
      h.lastSuspendedSeen = today;
      delete h.unsuspendedSeen; // re-suspended
    } else if (!h.unsuspendedSeen) {
      h.unsuspendedSeen = today; // first check where it is no longer suspended
    }
    h.lastStatus = r.status;
    h.lastChecked = today;
    history[id] = h;
    r.unsuspended_seen = suspended ? '' : h.unsuspendedSeen;
  }
  saveHistory(history);
  return out;
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5e6) reject(new Error('Body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/config') {
      return sendJson(res, 200, { hasServerToken: Boolean(ENV_TOKEN) });
    }
    if (req.method === 'GET' && req.url === '/api/history') {
      return sendJson(res, 200, loadHistory());
    }
    if (req.method === 'POST' && req.url === '/api/lookup') {
      const { ids, token } = JSON.parse(await readBody(req));
      const useToken = token || ENV_TOKEN;
      if (!useToken) return sendJson(res, 400, { error: 'Thiếu TikTok Access Token' });
      if (!Array.isArray(ids) || !ids.length) return sendJson(res, 400, { error: 'Không có advertiser_id' });
      const clean = [...new Set(ids.map(String).filter((s) => /^\d+$/.test(s)))];
      return sendJson(res, 200, { results: await lookup(clean, useToken) });
    }
    if (req.method === 'GET') {
      const urlPath = req.url.split('?')[0];
      const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
      if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(405); res.end();
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`Suspension checker running at http://localhost:${PORT}`));
