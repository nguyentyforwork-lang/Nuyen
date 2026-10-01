/* global Chart, Sortable */
'use strict';

// ---------- state ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

const state = {
  config: { budgetHitThreshold: 0.95 },
  bcs: [],
  bc: LS.get('bc', null),
  preset: 'today',
  includeToday: LS.get('includeToday', false),
  start: null,
  end: null,
  data: null,
  model: null,
  focus: { account: null, app: null }, // dashboard-wide filter
  pivotLevels: LS.get('pivotLevels', ['account', 'app']),
  expanded: new Set(),
  sorts: LS.get('sorts', {}),
  colOrder: LS.get('colOrder', {}),
  tab: 'overview',
  charts: {},
};

const DIMS = { account: 'Account', app: 'App', campaign: 'Campaign' };
const NONE_APP = '__none__';

// ---------- utils ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => (v == null || !Number.isFinite(v) ? '–' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2, minimumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 }));
const int = (v) => (v == null ? '–' : Math.round(v).toLocaleString('en-US'));
const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '–' : (v * 100).toFixed(d) + '%');
const roas = (rev, spend) => (spend > 0 ? rev / spend : null);
const cpi = (spend, inst) => (inst > 0 ? spend / inst : null);
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const roasCls = (r) => (r == null ? '' : r >= 1 ? 'roas-good' : r < 0.5 ? 'roas-bad' : '');
const roasCell = (r) => `<span class="${roasCls(r)}">${pct(r)}</span>`;

function sum(rows, f) { let s = 0; for (const r of rows) s += f(r); return s; }

// ---------- data model ----------
function buildModel(data) {
  const accounts = new Map();
  const apps = new Map();
  const campApp = new Map(); // "adv|cid" -> app_id
  const campaigns = new Map(); // "adv|cid" -> fact
  const thr = state.config.budgetHitThreshold;

  apps.set(NONE_APP, { app_id: NONE_APP, app_name: '(Campaign không gắn app)', platform: '' });

  for (const adv of data.advertisers) {
    accounts.set(adv.advertiser_id, adv);
    for (const a of adv.apps || []) if (!apps.has(a.app_id)) apps.set(a.app_id, a);
  }

  for (const adv of data.advertisers) {
    const id = adv.advertiser_id;
    // campaign -> app by majority ad spend (tt_app_id), fallback ad group app_id
    const votes = new Map();
    for (const ad of adv.ads) {
      if (!ad.app_id) continue;
      const k = `${id}|${ad.campaign_id}`;
      const m = votes.get(k) || new Map();
      m.set(ad.app_id, (m.get(ad.app_id) || 0) + ad.spend + 1e-9);
      votes.set(k, m);
    }
    for (const [k, m] of votes) campApp.set(k, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    for (const g of Object.values(adv.adgroups || {})) {
      const k = `${id}|${g.campaign_id}`;
      if (!campApp.has(k) && g.app_id) campApp.set(k, g.app_id);
    }

    for (const r of adv.campaignDaily) {
      const k = `${id}|${r.campaign_id}`;
      let f = campaigns.get(k);
      if (!f) {
        const appId = campApp.get(k) || NONE_APP;
        if (!apps.has(appId)) apps.set(appId, { app_id: appId, app_name: `App ${appId}`, platform: '' });
        const c = adv.campaigns?.[r.campaign_id] || {};
        f = {
          key: k, account: id, app: appId, campaign: r.campaign_id,
          campaign_name: r.campaign_name || c.name || r.campaign_id,
          spend: 0, rev: 0, installs: 0, byDay: {},
          status: c.status, budget: c.daily ? c.budget : null, budgetLevel: c.daily ? 'Campaign' : null,
          hitDays: 0, maxPct: null,
        };
        if (!c.daily) {
          // sum of daily ad group budgets as the effective cap
          const ags = Object.values(adv.adgroups || {}).filter((g) => g.campaign_id === r.campaign_id && g.daily && g.status !== 'DISABLE');
          if (ags.length) { f.budget = sum(ags, (g) => g.budget); f.budgetLevel = `Ad group ×${ags.length}`; }
        }
        campaigns.set(k, f);
      }
      f.spend += r.spend; f.rev += r.rev; f.installs += r.installs;
      f.byDay[r.date] = (f.byDay[r.date] || 0) + r.spend;
    }
  }

  // Budget hits
  const hits = [];
  for (const adv of data.advertisers) {
    const id = adv.advertiser_id;
    for (const r of adv.campaignDaily) {
      const c = adv.campaigns?.[r.campaign_id];
      if (!c?.daily || !(c.budget > 0)) continue;
      const p = r.spend / c.budget;
      const f = campaigns.get(`${id}|${r.campaign_id}`);
      if (f) f.maxPct = Math.max(f.maxPct ?? 0, p);
      if (p >= thr) {
        if (f) f.hitDays++;
        hits.push({ level: 'Campaign', account: id, app: f?.app || NONE_APP, campaign: r.campaign_id, campaign_name: f?.campaign_name || r.campaign_name, name: f?.campaign_name || r.campaign_name, date: r.date, spend: r.spend, budget: c.budget, pct: p, status: c.status });
      }
    }
    for (const r of adv.adgroupDaily) {
      const g = adv.adgroups?.[r.adgroup_id];
      if (!g?.daily || !(g.budget > 0)) continue;
      const p = r.spend / g.budget;
      const f = campaigns.get(`${id}|${r.campaign_id}`);
      if (f && !adv.campaigns?.[r.campaign_id]?.daily) f.maxPct = Math.max(f.maxPct ?? 0, p);
      if (p >= thr) {
        if (f && !adv.campaigns?.[r.campaign_id]?.daily) f.hitDays++;
        hits.push({ level: 'Ad group', account: id, app: f?.app || g.app_id || NONE_APP, campaign: r.campaign_id, campaign_name: f?.campaign_name || '', name: r.adgroup_name || g.name, date: r.date, spend: r.spend, budget: g.budget, pct: p, status: g.status });
      }
    }
  }
  hits.sort((a, b) => (b.date.localeCompare(a.date)) || b.pct - a.pct);

  // Event Manager links with no spend in range
  const linksNoSpend = [];
  for (const adv of data.advertisers) {
    const spentApps = new Set([...campaigns.values()].filter((f) => f.account === adv.advertiser_id).map((f) => f.app));
    for (const a of adv.apps || []) if (!spentApps.has(a.app_id)) linksNoSpend.push({ account: adv.advertiser_id, app: a.app_id });
  }

  return { accounts, apps, campApp, campaigns: [...campaigns.values()], hits, linksNoSpend };
}

function inFocus(account, app) {
  const { focus } = state;
  return (!focus.account || focus.account === account) && (!focus.app || focus.app === app);
}

const accName = (id) => state.model.accounts.get(id)?.name || id;
const appName = (id) => state.model.apps.get(id)?.app_name || id;
function appLabel(id) {
  const a = state.model.apps.get(id) || {};
  const icon = a.icon ? `<img class="appicon" src="${esc(a.icon)}" alt="" loading="lazy">` : '';
  const plat = a.platform ? ` <span class="tag">${esc(a.platform)}</span>` : '';
  return `${icon}${esc(a.app_name || id)}${plat}`;
}

// ---------- generic sortable table with draggable columns ----------
function renderTable(el, columns, rows, { defaultSort, onRow } = {}) {
  const id = el.id;
  const order = state.colOrder[id];
  let cols = columns;
  if (order) {
    const pos = new Map(order.map((k, i) => [k, i]));
    cols = [...columns].sort((a, b) => (pos.get(a.key) ?? 99) - (pos.get(b.key) ?? 99));
  }
  const sort = state.sorts[id] || defaultSort || null;
  if (sort) {
    const col = columns.find((c) => c.key === sort.key);
    if (col) {
      const v = col.sort || ((r) => r[col.key]);
      rows = [...rows].sort((a, b) => {
        const x = v(a), y = v(b);
        const cmp = typeof x === 'string' || typeof y === 'string' ? String(x ?? '').localeCompare(String(y ?? '')) : (x ?? -Infinity) - (y ?? -Infinity);
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
  }
  const head = cols.map((c) => `<th data-key="${c.key}" class="${c.cls || ''} ${sort?.key === c.key ? 'sorted ' + sort.dir : ''}">${c.label}</th>`).join('');
  const body = rows.length
    ? rows.map((r, i) => `<tr data-i="${i}">${cols.map((c) => `<td class="${c.cls || ''}">${c.fmt ? c.fmt(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length}" class="muted l">Không có dữ liệu</td></tr>`;
  el.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  bindHeader(el, columns, () => renderTable(el, columns, rows, { defaultSort, onRow }));
  if (onRow) el.querySelectorAll('tbody tr[data-i]').forEach((tr) => tr.addEventListener('click', (e) => onRow(rows[tr.dataset.i], e)));
}

function bindHeader(el, columns, rerender) {
  const id = el.id;
  const tr = el.querySelector('thead tr');
  tr.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
    const cur = state.sorts[id];
    const key = th.dataset.key;
    state.sorts[id] = { key, dir: cur?.key === key && cur.dir === 'desc' ? 'asc' : 'desc' };
    LS.set('sorts', state.sorts);
    rerender();
  }));
  if (window.Sortable) {
    Sortable.create(tr, {
      animation: 150,
      ghostClass: 'dragging',
      onEnd: () => {
        state.colOrder[id] = [...tr.querySelectorAll('th')].map((t) => t.dataset.key);
        LS.set('colOrder', state.colOrder);
        rerender();
      },
    });
  }
}

// ---------- charts ----------
function chartDefaults() {
  Chart.defaults.color = cssVar('--text-2');
  Chart.defaults.borderColor = cssVar('--grid');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
}
function setChart(id, cfg) {
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart(document.getElementById(id), cfg);
}
const baseOpts = (yFmt) => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false } },
    y: { beginAtZero: true, ticks: { callback: yFmt } },
  },
});

// ---------- renderers ----------
function renderAll() {
  if (!state.model) return;
  renderSubbar();
  renderOverview();
  renderPivot();
  renderCampaigns();
  renderCreatives();
}

function renderSubbar() {
  const advs = state.data.advertisers;
  const byTz = new Map();
  for (const a of advs) {
    const k = a.timezone;
    const e = byTz.get(k) || { n: 0, range: a.range };
    e.n++; byTz.set(k, e);
  }
  $('#tzInfo').innerHTML = 'Múi giờ theo ad account: ' + [...byTz.entries()].map(([tz, e]) =>
    `<b>${esc(tz)}</b> (${e.n} acc${e.range ? `, ${e.range.start === e.range.end ? e.range.start : e.range.start + ' → ' + e.range.end}` : ''})`).join(' · ');
  const chips = [];
  if (state.focus.account) chips.push(`<span class="fchip" data-clear="account">Account: ${esc(accName(state.focus.account))} ✕</span>`);
  if (state.focus.app) chips.push(`<span class="fchip" data-clear="app">App: ${esc(appName(state.focus.app))} ✕</span>`);
  $('#focusChips').innerHTML = chips.join('');
  $$('#focusChips .fchip').forEach((c) => c.addEventListener('click', () => { state.focus[c.dataset.clear] = null; renderAll(); }));
  const errs = advs.filter((a) => a.error);
  const st = $('#status');
  st.innerHTML = `${advs.length} ad account · cập nhật ${new Date(state.data.generated_at).toLocaleTimeString()}` +
    (errs.length ? ` · <span class="err" title="${esc(errs.map((e) => `${e.name}: ${e.error}`).join('\n'))}">${errs.length} account lỗi</span>` : '');
}

function filteredCampaigns() { return state.model.campaigns.filter((f) => inFocus(f.account, f.app)); }

function renderOverview() {
  const camps = filteredCampaigns();
  const spend = sum(camps, (f) => f.spend);
  const rev = sum(camps, (f) => f.rev);
  const inst = sum(camps, (f) => f.installs);
  const accs = new Set(camps.filter((f) => f.spend > 0).map((f) => f.account));
  const apps = new Set(camps.filter((f) => f.spend > 0 && f.app !== NONE_APP).map((f) => f.app));
  const hits = state.model.hits.filter((h) => inFocus(h.account, h.app));
  $('#kpis').innerHTML = [
    ['Spend', money(spend), ''],
    ['IAA revenue D0', money(rev), ''],
    ['ROAS IAA D0', pct(roas(rev, spend)), ''],
    ['Installs', int(inst), `CPI ${money(cpi(spend, inst))}`],
    ['App đang chạy', int(apps.size), `${accs.size} account có spend`],
    ['Chạm max budget', int(hits.length), 'campaign/ad group-ngày'],
  ].map(([l, v, s]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join('');

  // daily series
  const day = new Map();
  for (const adv of state.data.advertisers) {
    for (const r of adv.campaignDaily) {
      const app = state.model.campApp.get(`${adv.advertiser_id}|${r.campaign_id}`) || NONE_APP;
      if (!inFocus(adv.advertiser_id, app)) continue;
      const e = day.get(r.date) || { spend: 0, rev: 0 };
      e.spend += r.spend; e.rev += r.rev; day.set(r.date, e);
    }
  }
  const dates = [...day.keys()].sort();
  const c1 = cssVar('--series-1');
  setChart('spendChart', {
    type: 'bar',
    data: { labels: dates, datasets: [{ label: 'Spend', data: dates.map((d) => day.get(d).spend), backgroundColor: c1, borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 36 }] },
    options: { ...baseOpts((v) => money(v)), plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `Spend ${money(c.parsed.y)}` } } } },
  });
  setChart('roasChart', {
    type: 'line',
    data: { labels: dates, datasets: [{ label: 'ROAS IAA D0', data: dates.map((d) => roas(day.get(d).rev, day.get(d).spend)), borderColor: c1, backgroundColor: c1, borderWidth: 2, pointRadius: 4, tension: 0.25 }] },
    options: { ...baseOpts((v) => pct(v, 0)), plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const e = day.get(c.label); return `ROAS ${pct(c.parsed.y)} · Rev ${money(e.rev)} / Spend ${money(e.spend)}`; } } } } },
  });

  // geo
  const geo = new Map();
  for (const adv of state.data.advertisers) {
    for (const g of adv.geo) {
      const app = state.model.campApp.get(`${adv.advertiser_id}|${g.campaign_id}`) || NONE_APP;
      if (!inFocus(adv.advertiser_id, app)) continue;
      const e = geo.get(g.country) || { spend: 0, rev: 0, installs: 0 };
      e.spend += g.spend; e.rev += g.rev; e.installs += g.installs; geo.set(g.country, e);
    }
  }
  const topGeo = [...geo.entries()].sort((a, b) => b[1].spend - a[1].spend).slice(0, 12);
  setChart('geoChart', {
    type: 'bar',
    data: { labels: topGeo.map(([c]) => c), datasets: [{ label: 'Spend', data: topGeo.map(([, e]) => e.spend), backgroundColor: c1, borderRadius: { topRight: 4, bottomRight: 4 }, maxBarThickness: 22 }] },
    options: {
      ...baseOpts(), indexAxis: 'y',
      scales: { x: { beginAtZero: true, ticks: { callback: (v) => money(v) } }, y: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const e = topGeo[c.dataIndex][1]; return [`Spend ${money(e.spend)} (${pct(e.spend / (spend || 1))})`, `ROAS IAA D0 ${pct(roas(e.rev, e.spend))}`, `Installs ${int(e.installs)} · CPI ${money(cpi(e.spend, e.installs))}`]; } } } },
    },
  });

  // top campaigns
  const top = [...camps].sort((a, b) => b.spend - a.spend).slice(0, 10);
  const maxSpend = top[0]?.spend || 1;
  renderTable($('#topCampTable'), [
    { key: 'campaign_name', label: 'Campaign', cls: 'l name', fmt: (r) => `<span title="${esc(r.campaign_name)}">${esc(r.campaign_name)}</span>`, sort: (r) => r.campaign_name },
    { key: 'app', label: 'App', cls: 'l name', fmt: (r) => esc(appName(r.app)), sort: (r) => appName(r.app) },
    { key: 'spend', label: 'Spend', fmt: (r) => `<span class="bar" style="width:${Math.max(2, (r.spend / maxSpend) * 60)}px"></span>${money(r.spend)}` },
    { key: 'roas', label: 'ROAS D0', fmt: (r) => roasCell(roas(r.rev, r.spend)), sort: (r) => roas(r.rev, r.spend) },
    { key: 'budget', label: 'Max %', fmt: (r) => budgetTag(r), sort: (r) => r.maxPct },
  ], top, { defaultSort: { key: 'spend', dir: 'desc' } });

  $('#hitNote').textContent = `(spend ≥ ${pct(state.config.budgetHitThreshold, 0)} budget ngày)`;
  renderTable($('#hitTableMini'), hitColumns(), hits.slice(0, 15), { defaultSort: { key: 'date', dir: 'desc' } });
}

function budgetTag(f) {
  if (f.maxPct == null) return '<span class="muted">–</span>';
  const thr = state.config.budgetHitThreshold;
  const cls = f.maxPct >= thr ? 'hit' : f.maxPct >= 0.8 ? 'near' : '';
  return `<span class="tag ${cls}">${pct(f.maxPct, 0)}</span>`;
}

function hitColumns() {
  return [
    { key: 'date', label: 'Ngày', cls: 'l' },
    { key: 'level', label: 'Level', cls: 'l' },
    { key: 'name', label: 'Tên', cls: 'l name', fmt: (r) => `<span title="${esc(r.campaign_name)}">${esc(r.name)}</span>` },
    { key: 'account', label: 'Account', cls: 'l name', fmt: (r) => esc(accName(r.account)), sort: (r) => accName(r.account) },
    { key: 'app', label: 'App', cls: 'l name', fmt: (r) => esc(appName(r.app)), sort: (r) => appName(r.app) },
    { key: 'spend', label: 'Spend', fmt: (r) => money(r.spend) },
    { key: 'budget', label: 'Budget ngày', fmt: (r) => money(r.budget) },
    { key: 'pct', label: '% budget', fmt: (r) => `<span class="tag hit">${pct(r.pct, 0)}</span>` },
    { key: 'status', label: 'Trạng thái', cls: 'l', fmt: (r) => esc(r.status || '') },
  ];
}

// ---------- pivot (Account <-> App) ----------
function pivotFacts() {
  const q = $('#pivotSearch').value.trim().toLowerCase();
  const facts = state.model.campaigns.map((f) => ({ ...f, linked: false }));
  if ($('#showLinkedOnly').checked) {
    for (const l of state.model.linksNoSpend) facts.push({ key: `${l.account}|link|${l.app}`, account: l.account, app: l.app, campaign: null, campaign_name: '(chưa có campaign spend)', spend: 0, rev: 0, installs: 0, linked: true });
  }
  if (!q) return facts;
  return facts.filter((f) => [accName(f.account), f.account, appName(f.app), f.app, f.campaign_name, f.campaign].some((s) => String(s ?? '').toLowerCase().includes(q)));
}

function buildTree(facts, levels, depth = 0, prefix = '') {
  if (depth >= levels.length) return [];
  const dim = levels[depth];
  const groups = new Map();
  for (const f of facts) {
    const id = dim === 'campaign' ? (f.campaign || `link-${f.app}`) : f[dim];
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(f);
  }
  const nodes = [];
  for (const [id, rows] of groups) {
    const path = `${prefix}/${dim}:${id}`;
    const spend = sum(rows, (r) => r.spend), rev = sum(rows, (r) => r.rev), installs = sum(rows, (r) => r.installs);
    const camps = rows.filter((r) => r.campaign);
    nodes.push({
      path, dim, id, depth, rows,
      spend, rev, installs,
      roas: roas(rev, spend), cpi: cpi(spend, installs),
      campaigns: camps.length,
      hitCamps: camps.filter((r) => r.hitDays > 0).length,
      accounts: new Set(rows.map((r) => r.account)).size,
      apps: new Set(rows.filter((r) => r.app !== NONE_APP).map((r) => r.app)).size,
      linkedOnly: rows.every((r) => r.linked),
      children: buildTree(rows, levels, depth + 1, path),
    });
  }
  return nodes;
}

function pivotColumns() {
  return [
    { key: 'name', label: state.pivotLevels.map((l) => DIMS[l]).join(' → '), cls: 'l', sort: (n) => nodeName(n) },
    { key: 'sub', label: 'Xổ ra', sort: (n) => n.children.length },
    { key: 'spend', label: 'Spend' },
    { key: 'rev', label: 'IAA rev D0' },
    { key: 'roas', label: 'ROAS IAA D0' },
    { key: 'installs', label: 'Installs' },
    { key: 'cpi', label: 'CPI' },
    { key: 'campaigns', label: '#Camp' },
    { key: 'hitCamps', label: 'Camp chạm budget' },
    { key: 'status', label: 'Trạng thái', cls: 'l', sort: (n) => (n.spend > 0 ? 2 : n.linkedOnly ? 1 : 0) },
  ];
}

function nodeName(n) {
  if (n.dim === 'account') return accName(n.id);
  if (n.dim === 'app') return appName(n.id);
  return n.rows[0]?.campaign_name || n.id;
}

function nodeLabel(n) {
  if (n.dim === 'account') {
    const a = state.model.accounts.get(n.id) || {};
    return `${esc(a.name || n.id)} <span class="count">${esc(n.id)} · ${esc(a.timezone || '')}${a.currency && a.currency !== 'USD' ? ' · ' + esc(a.currency) : ''}</span>`;
  }
  if (n.dim === 'app') return `${appLabel(n.id)} <span class="count">${n.id === NONE_APP ? '' : esc(n.id)}</span>`;
  return `<span title="${esc(nodeName(n))}">${esc(nodeName(n))}</span>`;
}

function subLabel(n) {
  if (!n.children.length) return '';
  const next = n.children[0].dim;
  const label = { account: 'account', app: 'app', campaign: 'camp' }[next];
  return `${n.children.length} ${label}`;
}

function renderPivot() {
  const el = $('#pivotTable');
  renderPivotChips();
  const facts = pivotFacts().filter((f) => inFocus(f.account, f.app));
  const tree = buildTree(facts, state.pivotLevels);
  const columns = pivotColumns();
  const order = state.colOrder.pivotTable;
  let cols = columns;
  if (order) {
    const pos = new Map(order.map((k, i) => [k, i]));
    cols = [...columns].sort((a, b) => (pos.get(a.key) ?? 99) - (pos.get(b.key) ?? 99));
  }
  const sort = state.sorts.pivotTable || { key: 'spend', dir: 'desc' };
  const sortCol = columns.find((c) => c.key === sort.key) || columns[2];
  const val = sortCol.sort || ((n) => n[sortCol.key]);
  const sortNodes = (nodes) => nodes.sort((a, b) => {
    const x = val(a), y = val(b);
    const cmp = typeof x === 'string' ? x.localeCompare(y) : (x ?? -Infinity) - (y ?? -Infinity);
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  const searching = $('#pivotSearch').value.trim() !== '';
  const thr = state.config.budgetHitThreshold;

  const cell = (n, key) => {
    switch (key) {
      case 'name': {
        const tog = n.children.length ? `<span class="toggle">${state.expanded.has(n.path) || searching ? '▾' : '▸'}</span>` : '<span class="toggle"></span>';
        return `${tog}${nodeLabel(n)}<button class="focusbtn" title="Lọc dashboard theo dòng này" data-focus="${esc(n.path)}">🎯</button>`;
      }
      case 'sub': return subLabel(n);
      case 'spend': return money(n.spend);
      case 'rev': return money(n.rev);
      case 'roas': return roasCell(n.roas);
      case 'installs': return int(n.installs);
      case 'cpi': return money(n.cpi);
      case 'campaigns': return int(n.campaigns);
      case 'hitCamps': return n.hitCamps ? `<span class="tag hit">${n.hitCamps}</span>` : '';
      case 'status': {
        if (n.dim === 'campaign') {
          const f = n.rows[0];
          if (!f.campaign) return '<span class="tag">Event Manager</span>';
          const tag = f.maxPct != null && f.maxPct >= thr ? ' <span class="tag hit">Max budget</span>' : '';
          return `<span class="tag ${f.status === 'ENABLE' ? 'run' : ''}">${esc(f.status || '–')}</span>${tag}`;
        }
        if (n.spend > 0) return '<span class="tag run">Đang chạy</span>';
        return n.linkedOnly ? '<span class="tag">Link EM, chưa spend</span>' : '<span class="tag">0 spend</span>';
      }
      default: return '';
    }
  };

  const out = [];
  const walk = (nodes) => {
    for (const n of sortNodes(nodes)) {
      out.push(`<tr class="lvl${n.depth}" data-path="${esc(n.path)}">${cols.map((c) => `<td class="${c.cls || ''}">${cell(n, c.key)}</td>`).join('')}</tr>`);
      if (n.children.length && (state.expanded.has(n.path) || searching)) walk(n.children);
    }
  };
  walk(tree);
  const sortedHead = (c) => (sort.key === c.key ? `sorted ${sort.dir}` : '');
  el.innerHTML = `<thead><tr>${cols.map((c) => `<th data-key="${c.key}" class="${c.cls || ''} ${sortedHead(c)}">${c.label}</th>`).join('')}</tr></thead>` +
    `<tbody>${out.join('') || `<tr><td colspan="${cols.length}" class="muted l">Không có dữ liệu</td></tr>`}</tbody>`;
  if (!state.sorts.pivotTable) state.sorts.pivotTable = sort;
  bindHeader(el, columns, renderPivot);

  const nodeByPath = new Map();
  const index = (nodes) => nodes.forEach((n) => { nodeByPath.set(n.path, n); index(n.children); });
  index(tree);

  el.querySelectorAll('tbody tr[data-path]').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      const p = tr.dataset.path;
      if (e.target.closest('.focusbtn')) {
        const n = nodeByPath.get(p);
        applyFocusFromPath(n.path);
        return;
      }
      if (!nodeByPath.get(p)?.children.length) return;
      if (state.expanded.has(p)) state.expanded.delete(p); else state.expanded.add(p);
      renderPivot();
    });
  });
  state._pivotTree = tree;
}

function applyFocusFromPath(path) {
  const focus = { account: null, app: null };
  for (const seg of path.split('/').filter(Boolean)) {
    const [dim, ...rest] = seg.split(':');
    const id = rest.join(':');
    if (dim === 'account') focus.account = id;
    if (dim === 'app') focus.app = id;
    if (dim === 'campaign') {
      const f = state.model.campaigns.find((c) => c.campaign === id);
      if (f) { focus.account = f.account; focus.app = f.app; }
    }
  }
  state.focus = focus;
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderPivotChips() {
  const lv = $('#pivotLevels');
  const pool = $('#pivotPool');
  lv.innerHTML = state.pivotLevels.map((d) => `<span class="chip" data-dim="${d}">${DIMS[d]}</span>`).join('');
  pool.innerHTML = Object.keys(DIMS).filter((d) => !state.pivotLevels.includes(d)).map((d) => `<span class="chip" data-dim="${d}">${DIMS[d]}</span>`).join('');
}

function initPivotDnD() {
  const onEnd = () => {
    const levels = [...$('#pivotLevels').querySelectorAll('.chip')].map((c) => c.dataset.dim);
    if (levels.length) setPivot(levels);
    else renderPivotChips();
  };
  Sortable.create($('#pivotLevels'), { group: 'pivot', animation: 150, onEnd, onAdd: onEnd });
  Sortable.create($('#pivotPool'), { group: 'pivot', animation: 150, onAdd: onEnd });
  $$('[data-pivot]').forEach((b) => b.addEventListener('click', () => setPivot(b.dataset.pivot.split(','))));
}

function setPivot(levels) {
  state.pivotLevels = levels;
  state.expanded.clear();
  LS.set('pivotLevels', levels);
  renderPivot();
}

// ---------- campaigns ----------
function renderCampaigns() {
  $('#thr').textContent = pct(state.config.budgetHitThreshold, 0);
  const camps = filteredCampaigns();
  renderTable($('#campTable'), [
    { key: 'campaign_name', label: 'Campaign', cls: 'l name', fmt: (r) => `<span title="${esc(r.campaign_name)} (${esc(r.campaign)})">${esc(r.campaign_name)}</span>` },
    { key: 'account', label: 'Account', cls: 'l name', fmt: (r) => esc(accName(r.account)), sort: (r) => accName(r.account) },
    { key: 'app', label: 'App', cls: 'l name', fmt: (r) => esc(appName(r.app)), sort: (r) => appName(r.app) },
    { key: 'status', label: 'Status', cls: 'l', fmt: (r) => `<span class="tag ${r.status === 'ENABLE' ? 'run' : ''}">${esc(r.status || '–')}</span>` },
    { key: 'budget', label: 'Budget ngày', fmt: (r) => (r.budget ? `${money(r.budget)} <span class="count">${esc(r.budgetLevel)}</span>` : '<span class="muted">không giới hạn</span>') },
    { key: 'spend', label: 'Spend', fmt: (r) => money(r.spend) },
    { key: 'rev', label: 'IAA rev D0', fmt: (r) => money(r.rev) },
    { key: 'roas', label: 'ROAS IAA D0', fmt: (r) => roasCell(roas(r.rev, r.spend)), sort: (r) => roas(r.rev, r.spend) },
    { key: 'installs', label: 'Installs', fmt: (r) => int(r.installs) },
    { key: 'cpi', label: 'CPI', fmt: (r) => money(cpi(r.spend, r.installs)), sort: (r) => cpi(r.spend, r.installs) },
    { key: 'maxPct', label: 'Max % budget/ngày', fmt: budgetTag },
    { key: 'hitDays', label: 'Số ngày chạm max', fmt: (r) => (r.hitDays ? `<span class="tag hit">${r.hitDays}</span>` : '') },
  ], camps, { defaultSort: { key: 'spend', dir: 'desc' } });

  const hits = state.model.hits.filter((h) => inFocus(h.account, h.app));
  renderTable($('#hitTable'), hitColumns(), hits, { defaultSort: { key: 'date', dir: 'desc' } });
}

// ---------- creatives ----------
function creativeKey(name, mode) {
  if (mode === 'ad') return name;
  const m = /^(.*?\.(mp4|mov|m4v|webm|avi))/i.exec(name || '');
  return m ? m[1] : name;
}

function renderCreatives() {
  const mode = $('#creativeGroup').value;
  const minSpend = Number($('#minSpend').value) || 0;
  const q = $('#creativeSearch').value.trim().toLowerCase();
  const groups = new Map();
  for (const adv of state.data.advertisers) {
    for (const ad of adv.ads) {
      const app = ad.app_id || state.model.campApp.get(`${adv.advertiser_id}|${ad.campaign_id}`) || NONE_APP;
      if (!inFocus(adv.advertiser_id, app)) continue;
      const k = creativeKey(ad.ad_name, mode) || ad.ad_id;
      const g = groups.get(k) || { name: k, spend: 0, rev: 0, installs: 0, impressions: 0, clicks: 0, ads: 0, apps: new Set(), accounts: new Set() };
      g.spend += ad.spend; g.rev += ad.rev; g.installs += ad.installs; g.impressions += ad.impressions; g.clicks += ad.clicks; g.ads++;
      g.apps.add(app); g.accounts.add(adv.advertiser_id);
      groups.set(k, g);
    }
  }
  let rows = [...groups.values()].filter((g) => g.spend >= minSpend && (!q || g.name.toLowerCase().includes(q)));
  rows.forEach((g) => { g.roas = roas(g.rev, g.spend); g.cpi = cpi(g.spend, g.installs); g.ctr = g.impressions ? g.clicks / g.impressions : null; });

  renderTable($('#creativeTable'), [
    { key: 'name', label: 'Creative', cls: 'l name', fmt: (r) => `<span title="${esc(r.name)}">${esc(r.name)}</span>` },
    { key: 'apps', label: 'App', cls: 'l name', fmt: (r) => esc([...r.apps].map(appName).join(', ')), sort: (r) => [...r.apps].map(appName).join(',') },
    { key: 'ads', label: '#Ads', fmt: (r) => int(r.ads) },
    { key: 'spend', label: 'Spend', fmt: (r) => money(r.spend) },
    { key: 'rev', label: 'IAA rev D0', fmt: (r) => money(r.rev) },
    { key: 'roas', label: 'ROAS IAA D0', fmt: (r) => roasCell(r.roas) },
    { key: 'installs', label: 'Installs', fmt: (r) => int(r.installs) },
    { key: 'cpi', label: 'CPI', fmt: (r) => money(r.cpi) },
    { key: 'ctr', label: 'CTR', fmt: (r) => pct(r.ctr, 2) },
  ], rows, { defaultSort: { key: 'spend', dir: 'desc' } });

  const top = [...rows].sort((a, b) => b.spend - a.spend).slice(0, 60);
  const c1 = cssVar('--series-1');
  setChart('creativeChart', {
    type: 'scatter',
    data: { datasets: [{ label: 'Creative', data: top.map((g) => ({ x: g.spend, y: g.roas ?? 0, g })), backgroundColor: c1 + 'b3', borderColor: cssVar('--surface'), borderWidth: 2, pointRadius: 6, pointHoverRadius: 9 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const g = c.raw.g; return [g.name.slice(0, 60), `Spend ${money(g.spend)} · ROAS ${pct(g.roas)}`, `Installs ${int(g.installs)} · CPI ${money(g.cpi)}`]; } } } },
      scales: {
        x: { title: { display: true, text: 'Spend' }, beginAtZero: true, ticks: { callback: (v) => money(v) } },
        y: { title: { display: true, text: 'ROAS IAA D0' }, beginAtZero: true, ticks: { callback: (v) => pct(v, 0) } },
      },
    },
  });
}

// ---------- loading ----------
async function api(path) {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

let loadSeq = 0;
async function load(refresh = false) {
  if (!state.bc) return;
  const seq = ++loadSeq;
  const qs = new URLSearchParams({ bc_id: state.bc, preset: state.preset, include_today: state.includeToday ? '1' : '0' });
  if (state.preset === 'custom') {
    if (!state.start || !state.end) return;
    qs.set('start', state.start); qs.set('end', state.end);
  }
  if (refresh) qs.set('refresh', '1');
  const t0 = Date.now();
  const st = $('#status');
  const timer = setInterval(() => { st.textContent = `Đang tải dữ liệu từ TikTok… ${Math.round((Date.now() - t0) / 1000)}s`; }, 500);
  try {
    const data = await api(`/api/overview?${qs}`);
    if (seq !== loadSeq) return;
    state.data = data;
    state.model = buildModel(data);
    if (state.focus.account && !state.model.accounts.has(state.focus.account)) state.focus = { account: null, app: null };
    clearInterval(timer);
    renderAll();
  } catch (e) {
    clearInterval(timer);
    if (seq === loadSeq) st.innerHTML = `<span class="err">Lỗi: ${esc(e.message)}</span>`;
  }
}

async function init() {
  chartDefaults();
  try { state.config = await api('/api/config'); } catch { /* defaults */ }
  $('#demoBadge').hidden = !state.config.demo;
  $('#includeToday').checked = state.includeToday;

  // tabs
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${b.dataset.tab}`));
    Object.values(state.charts).forEach((c) => c.resize());
  }));

  // presets
  $$('#presetSeg button').forEach((b) => b.addEventListener('click', () => {
    $$('#presetSeg button').forEach((x) => x.classList.toggle('active', x === b));
    state.preset = b.dataset.preset;
    $('#customRange').hidden = state.preset !== 'custom';
    if (state.preset === 'custom') {
      const t = new Date().toISOString().slice(0, 10);
      $('#endDate').value ||= t;
      $('#startDate').value ||= t;
      state.start = $('#startDate').value; state.end = $('#endDate').value;
    }
    load();
  }));
  ['#startDate', '#endDate'].forEach((s) => $(s).addEventListener('change', () => {
    state.start = $('#startDate').value; state.end = $('#endDate').value; load();
  }));
  $('#includeToday').addEventListener('change', (e) => {
    state.includeToday = e.target.checked; LS.set('includeToday', state.includeToday);
    if (/^last/.test(state.preset)) load();
  });
  $('#refreshBtn').addEventListener('click', () => load(true));

  // pivot tools
  initPivotDnD();
  $('#pivotSearch').addEventListener('input', () => state.model && renderPivot());
  $('#showLinkedOnly').addEventListener('change', () => state.model && renderPivot());
  $('#expandAll').addEventListener('click', () => {
    const add = (nodes) => nodes.forEach((n) => { if (n.children.length) state.expanded.add(n.path); add(n.children); });
    add(state._pivotTree || []); renderPivot();
  });
  $('#collapseAll').addEventListener('click', () => { state.expanded.clear(); renderPivot(); });

  // creative tools
  ['#creativeGroup', '#minSpend', '#creativeSearch'].forEach((s) => $(s).addEventListener('input', () => state.model && renderCreatives()));

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { chartDefaults(); renderAll(); });

  // BCs
  try {
    const { bcs } = await api('/api/bcs');
    state.bcs = bcs;
    const sel = $('#bcSelect');
    sel.innerHTML = bcs.map((b) => `<option value="${esc(b.bc_id)}">${esc(b.name)} (${esc(b.bc_id)})</option>`).join('');
    if (!bcs.some((b) => b.bc_id === state.bc)) state.bc = bcs[0]?.bc_id || null;
    sel.value = state.bc;
    sel.addEventListener('change', () => { state.bc = sel.value; LS.set('bc', state.bc); state.focus = { account: null, app: null }; state.expanded.clear(); load(); });
    load();
  } catch (e) {
    $('#status').innerHTML = `<span class="err">Không tải được danh sách BC: ${esc(e.message)}</span>`;
  }
}

init();
