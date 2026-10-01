require('dotenv').config();
const path = require('path');
const express = require('express');
const { createClient } = require('./tiktok');
const { createService } = require('./service');
const { mockBCs, mockOverview } = require('./mock');
const { PRESETS } = require('./dates');

function parseJson(s, fallback) {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

const config = {
  token: process.env.TIKTOK_ACCESS_TOKEN || '',
  port: Number(process.env.PORT) || 3000,
  password: process.env.APP_PASSWORD || '',
  iaaRevenueMetric: process.env.IAA_REVENUE_METRIC || 'ad_impression_ad_revenue_day0',
  budgetHitThreshold: Number(process.env.BUDGET_HIT_THRESHOLD) || 0.95,
  fxToUsd: parseJson(process.env.FX_TO_USD, { USD: 1, VND: 0.000038 }),
  concurrency: Number(process.env.CONCURRENCY) || 4,
  cacheTtl: (Number(process.env.CACHE_TTL) || 300) * 1000,
};
const demo = !config.token;
const service = demo ? null : createService(createClient(config.token), config);

const cache = new Map();
async function cached(key, fn, force) {
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.t < config.cacheTtl) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

const app = express();

if (config.password) {
  app.use((req, res, next) => {
    const [, b64] = (req.headers.authorization || '').split(' ');
    const pass = b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
    if (pass === config.password) return next();
    res.set('WWW-Authenticate', 'Basic realm="App Tracker"').status(401).send('Auth required');
  });
}

app.use(express.static(path.join(__dirname, '..', 'public')));
// Front-end libs served from node_modules (no CDN dependency).
const nm = path.join(__dirname, '..', 'node_modules');
app.get('/vendor/chart.umd.js', (req, res) => res.sendFile(path.join(nm, 'chart.js', 'dist', 'chart.umd.js')));
app.get('/vendor/Sortable.min.js', (req, res) => res.sendFile(path.join(nm, 'sortablejs', 'Sortable.min.js')));

app.get('/api/config', (req, res) => {
  res.json({ demo, budgetHitThreshold: config.budgetHitThreshold, iaaRevenueMetric: config.iaaRevenueMetric });
});

app.get('/api/bcs', async (req, res) => {
  try {
    const bcs = demo ? mockBCs() : await cached('bcs', () => service.listBCs(), req.query.refresh === '1');
    res.json({ bcs });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/overview', async (req, res) => {
  const { bc_ids: ids, preset = 'today', start, end, include_today: inc, refresh } = req.query;
  const bcIds = [...new Set(String(ids || '').split(',').map((s) => s.trim()).filter(Boolean))].sort();
  if (!bcIds.length) return res.status(400).json({ error: 'bc_ids is required' });
  if (!PRESETS.includes(preset)) return res.status(400).json({ error: 'invalid preset' });
  const rangeReq = { preset, start, end, includeToday: inc === '1' };
  try {
    const data = demo
      ? mockOverview(bcIds, rangeReq, config)
      : await cached(`ov:${bcIds.join(',')}:${JSON.stringify(rangeReq)}`, () => service.overview(bcIds, rangeReq), refresh === '1');
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.listen(config.port, () => {
  console.log(`App Tracker on http://localhost:${config.port} ${demo ? '(DEMO mode – set TIKTOK_ACCESS_TOKEN for live data)' : ''}`);
});
