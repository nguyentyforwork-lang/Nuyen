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
  selectedBcs: LS.get('selectedBcs', []),
  preset: 'today',
  includeToday: LS.get('includeToday', false),
  start: null,
  end: null,
  data: null,
  model: null,
  focus: { bc: null, account: null, app: null }, // dashboard-wide filter
  midOrder: LS.get('midOrder', ['account', 'app']),
  lvSort: LS.get('lvSort', { key: 'spend', dir: 'desc' }),
  expandTo: 1,
  openOverrides: new Map(), // path -> bool (manual expand/collapse)
  sorts: LS.get('sorts', {}),
  colOrder: LS.get('colOrder', {}),
  charts: {},
};

const DIMS = { bc: 'BC', account: 'Account', app: 'App', campaign: 'Campaign', creative: 'Creative' };
const NONE_APP = '__none__';

// ---------- utils ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => (v == null || !Number.isFinite(v) ? '–' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2, minimumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 }));
const int = (v) => (v == null ? '–' : Math.round(v).toLocaleString('en-US'));
const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '–' : (v * 100).toFixed(d) + '%');
const roas = (rev, spend) => (spend > 0 ? rev / spend : null);
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const roasCls = (r) => (r == null ? '' : r >= 1 ? 'roas-good' : r < 0.5 ? 'roas-bad' : '');
const roasCell = (r) => `<span class="${roasCls(r)}">${pct(r)}</span>`;
function sum(rows, f) { let s = 0; for (const r of rows) s += f(r); return s; }

// ---------- geo helpers ----------
function addGeo(target, src) {
  if (!src) return target;
  for (const [c, e] of src) {
    const t = target.get(c) || { spend: 0, rev: 0 };
    t.spend += e.spend; t.rev += e.rev; target.set(c, t);
  }
  return target;
}
function topGeoCell(geo, total) {
  if (!geo || !geo.size || !(total > 0)) return '<span class="muted">–</span>';
  const top = [...geo.entries()].sort((a, b) => b[1].spend - a[1].spend);
  const title = top.slice(0, 8).map(([c, e]) => `${c}: ${money(e.spend)} (${pct(e.spend / total, 0)}) · ROAS ${pct(roas(e.rev, e.spend))}`).join('\n');
  return `<span class="geo" title="${esc(title)}">${top.slice(0, 3).map(([c, e]) => `<span class="gchip"><b>${esc(c)}</b> ${pct(e.spend / total, 0)}</span>`).join('')}</span>`;
}

// ---------- data model ----------
function creativeKey(name, mode) {
  if (mode === 'ad') return name;
  const m = /^(.*?\.(mp4|mov|m4v|webm|avi))/i.exec(name || '');
  return m ? m[1] : name;
}

function buildModel(data) {
  const accounts = new Map();
  const apps = new Map();
  const campApp = new Map(); // "adv|cid" -> app_id
  const campaigns = new Map(); // "adv|cid" -> fact
  const campGeo = new Map(); // "adv|cid" -> Map(country -> {spend, rev})
  const campAds = new Map(); // "adv|cid" -> [ad]
  const adGeo = new Map(); // "adv|ad_id" -> Map(country -> {spend, rev})
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
      const k = `${id}|${ad.campaign_id}`;
      if (!campAds.has(k)) campAds.set(k, []);
      campAds.get(k).push(ad);
      if (!ad.app_id) continue;
      const m = votes.get(k) || new Map();
      m.set(ad.app_id, (m.get(ad.app_id) || 0) + ad.spend + 1e-9);
      votes.set(k, m);
    }
    for (const [k, m] of votes) campApp.set(k, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    for (const g of Object.values(adv.adgroups || {})) {
      const k = `${id}|${g.campaign_id}`;
      if (!campApp.has(k) && g.app_id) campApp.set(k, g.app_id);
    }
    for (const g of adv.geo || []) {
      const k = `${id}|${g.campaign_id}`;
      addGeo(campGeo.get(k) || campGeo.set(k, new Map()).get(k), [[g.country, g]]);
    }
    for (const g of adv.adGeo || []) {
      const k = `${id}|${g.ad_id}`;
      addGeo(adGeo.get(k) || adGeo.set(k, new Map()).get(k), [[g.country, g]]);
    }

    for (const r of adv.campaignDaily) {
      const k = `${id}|${r.campaign_id}`;
      let f = campaigns.get(k);
      if (!f) {
        const appId = campApp.get(k) || NONE_APP;
        if (!apps.has(appId)) apps.set(appId, { app_id: appId, app_name: `App ${appId}`, platform: '' });
        const c = adv.campaigns?.[r.campaign_id] || {};
        f = {
          key: k, bc: adv.bc_id, account: id, app: appId, campaign: r.campaign_id,
          campaign_name: r.campaign_name || c.name || r.campaign_id,
          spend: 0, rev: 0,
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
      f.spend += r.spend; f.rev += r.rev;
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
        hits.push({ level: 'Campaign', bc: adv.bc_id, account: id, app: f?.app || NONE_APP, campaign: r.campaign_id, campaign_name: f?.campaign_name || r.campaign_name, name: f?.campaign_name || r.campaign_name, date: r.date, spend: r.spend, budget: c.budget, pct: p, status: c.status });
      }
    }
    for (const r of adv.adgroupDaily) {
      const g = adv.adgroups?.[r.adgroup_id];
      if (!g?.daily || !(g.budget > 0)) continue;
      const p = r.spend / g.budget;
      const f = campaigns.get(`${id}|${r.campaign_id}`);
      const cbo = adv.campaigns?.[r.campaign_id]?.daily;
      if (f && !cbo) f.maxPct = Math.max(f.maxPct ?? 0, p);
      if (p >= thr) {
        if (f && !cbo) f.hitDays++;
        hits.push({ level: 'Ad group', bc: adv.bc_id, account: id, app: f?.app || g.app_id || NONE_APP, campaign: r.campaign_id, campaign_name: f?.campaign_name || '', name: r.adgroup_name || g.name, date: r.date, spend: r.spend, budget: g.budget, pct: p, status: g.status });
      }
    }
  }
  hits.sort((a, b) => (b.date.localeCompare(a.date)) || b.pct - a.pct);

  // Event Manager links with no spend in range
  const linksNoSpend = [];
  for (const adv of data.advertisers) {
    const spentApps = new Set([...campaigns.values()].filter((f) => f.account === adv.advertiser_id).map((f) => f.app));
    for (const a of adv.apps || []) if (!spentApps.has(a.app_id)) linksNoSpend.push({ bc: adv.bc_id, account: adv.advertiser_id, app: a.app_id });
  }

  return { accounts, apps, campApp, campaigns: [...campaigns.values()], campGeo, campAds, adGeo, hits, linksNoSpend };
}

function inFocus(bc, account, app) {
  const { focus } = state;
  return (!focus.bc || focus.bc === bc) && (!focus.account || focus.account === account) && (!focus.app || focus.app === app);
}

const bcName = (id) => state.bcs.find((b) => b.bc_id === id)?.name || id;
const accName = (id) => state.model.accounts.get(id)?.name || id;
const appName = (id) => state.model.apps.get(id)?.app_name || id;
function appLabel(id) {
  const a = state.model.apps.get(id) || {};
  const icon = a.icon ? `<img class="appicon" src="${esc(a.icon)}" alt="" loading="lazy">` : '';
  const plat = a.platform ? ` <span class="tag">${esc(a.platform)}</span>` : '';
  return `${icon}${esc(a.app_name || id)}${plat}`;
}

// ---------- generic sortable table with draggable columns ----------
function renderTable(el, columns, rows, { defaultSort } = {}) {
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
      rows = [...rows].sort((a, b) => cmpVals(v(a), v(b), sort.dir));
    }
  }
  const head = cols.map((c) => `<th data-key="${c.key}" class="${c.cls || ''} ${sort?.key === c.key ? 'sorted ' + sort.dir : ''}">${c.label}</th>`).join('');
  const body = rows.length
    ? rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.cls || ''}">${c.fmt ? c.fmt(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length}" class="muted l">Không có dữ liệu</td></tr>`;
  el.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  const tr = el.querySelector('thead tr');
  tr.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
    const cur = state.sorts[id] || defaultSort;
    const key = th.dataset.key;
    state.sorts[id] = { key, dir: cur?.key === key && cur.dir === 'desc' ? 'asc' : 'desc' };
    LS.set('sorts', state.sorts);
    renderTable(el, columns, rows, { defaultSort });
  }));
  if (window.Sortable) {
    Sortable.create(tr, {
      animation: 150,
      ghostClass: 'dragging',
      onEnd: () => {
        state.colOrder[id] = [...tr.querySelectorAll('th')].map((t) => t.dataset.key);
        LS.set('colOrder', state.colOrder);
        renderTable(el, columns, rows, { defaultSort });
      },
    });
  }
}

// null/undefined always sink to the bottom, whatever the direction
function cmpVals(x, y, dir) {
  const xn = x == null || (typeof x === 'number' && !Number.isFinite(x));
  const yn = y == null || (typeof y === 'number' && !Number.isFinite(y));
  if (xn || yn) return xn === yn ? 0 : xn ? 1 : -1;
  const c = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : x - y;
  return dir === 'asc' ? c : -c;
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
  scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: yFmt } } },
});

// ---------- renderers ----------
function renderAll() {
  if (!state.model) return;
  renderSubbar();
  renderLevels();
  renderOverview();
  renderCampaigns();
  renderCreatives();
}

function renderSubbar() {
  const advs = state.data.advertisers;
  const byTz = new Map();
  for (const a of advs) {
    const e = byTz.get(a.timezone) || { n: 0, range: a.range };
    e.n++; byTz.set(a.timezone, e);
  }
  $('#tzInfo').innerHTML = 'Múi giờ theo ad account: ' + [...byTz.entries()].map(([tz, e]) =>
    `<b>${esc(tz)}</b> (${e.n} acc${e.range ? `, ${e.range.start === e.range.end ? e.range.start : e.range.start + ' → ' + e.range.end}` : ''})`).join(' · ');
  const chips = [];
  if (state.focus.bc) chips.push(`<span class="fchip" data-clear="bc">BC: ${esc(bcName(state.focus.bc))} ✕</span>`);
  if (state.focus.account) chips.push(`<span class="fchip" data-clear="account">Account: ${esc(accName(state.focus.account))} ✕</span>`);
  if (state.focus.app) chips.push(`<span class="fchip" data-clear="app">App: ${esc(appName(state.focus.app))} ✕</span>`);
  $('#focusChips').innerHTML = chips.join('');
  $$('#focusChips .fchip').forEach((c) => c.addEventListener('click', () => { state.focus[c.dataset.clear] = null; renderAll(); }));
  const errs = advs.filter((a) => a.error);
  $('#status').innerHTML = `${state.selectedBcs.length} BC · ${advs.length} ad account · cập nhật ${new Date(state.data.generated_at).toLocaleTimeString()}` +
    (errs.length ? ` · <span class="err" title="${esc(errs.map((e) => `${e.name}: ${e.error}`).join('\n'))}">${errs.length} account lỗi</span>` : '');
}

function filteredCampaigns() { return state.model.campaigns.filter((f) => inFocus(f.bc, f.account, f.app)); }

// ---------- LEVELS: BC -> Account <-> App -> Campaign -> Creative ----------
function levelDims() { return ['bc', ...state.midOrder, 'campaign', 'creative']; }

function levelFacts() {
  const q = $('#pivotSearch').value.trim().toLowerCase();
  const mode = $('#creativeGroupLv').value;
  let facts = state.model.campaigns.map((f) => ({ ...f }));
  if ($('#showLinkedOnly').checked) {
    for (const l of state.model.linksNoSpend) facts.push({ key: `${l.account}|link|${l.app}`, bc: l.bc, account: l.account, app: l.app, campaign: null, campaign_name: '(chưa có campaign spend)', spend: 0, rev: 0, linked: true });
  }
  facts = facts.filter((f) => inFocus(f.bc, f.account, f.app));
  if (!q) return facts;
  const has = (s) => String(s ?? '').toLowerCase().includes(q);
  return facts.filter((f) => {
    if ([bcName(f.bc), f.bc, accName(f.account), f.account, appName(f.app), f.app, f.campaign_name, f.campaign].some(has)) return true;
    const ads = state.model.campAds.get(f.key) || [];
    if (ads.some((a) => has(creativeKey(a.ad_name, mode)))) { f.creativeQuery = q; return true; }
    return false;
  });
}

function creativeNodes(f, parentPath, depth) {
  const mode = $('#creativeGroupLv').value;
  const ads = state.model.campAds.get(f.key) || [];
  const groups = new Map();
  for (const ad of ads) {
    const k = creativeKey(ad.ad_name, mode) || ad.ad_id;
    if (f.creativeQuery && !k.toLowerCase().includes(f.creativeQuery)) continue;
    const g = groups.get(k) || { name: k, spend: 0, rev: 0, ads: 0, geo: new Map() };
    g.spend += ad.spend; g.rev += ad.rev; g.ads++;
    addGeo(g.geo, state.model.adGeo.get(`${f.account}|${ad.ad_id}`));
    groups.set(k, g);
  }
  const nodes = [...groups.values()].map((g) => ({
    path: `${parentPath}/creative:${g.name}`, dim: 'creative', id: g.name, depth, label: g.name,
    spend: g.spend, rev: g.rev, roas: roas(g.rev, g.spend), geo: g.geo, ads: g.ads, children: [], rows: [],
  }));
  // Spend of deleted ads (not returned at ad level) so the children add up to the campaign.
  const rest = f.spend - sum(nodes, (n) => n.spend);
  if (!f.creativeQuery && rest > Math.max(1, f.spend * 0.01)) {
    const rrev = Math.max(0, f.rev - sum(nodes, (n) => n.rev));
    nodes.push({ path: `${parentPath}/creative:__rest`, dim: 'creative', id: '__rest', depth, label: '(Ad đã xoá / không có dữ liệu ad)', spend: rest, rev: rrev, roas: roas(rrev, rest), geo: null, children: [], rows: [], muted: true });
  }
  return nodes;
}

function buildLevelTree(facts, dims, depth = 0, prefix = '') {
  const dim = dims[depth];
  if (dim === 'creative') return [];
  const groups = new Map();
  for (const f of facts) {
    const id = dim === 'campaign' ? (f.campaign || `link-${f.app}`) : f[dim];
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(f);
  }
  const nodes = [];
  for (const [id, rows] of groups) {
    const path = `${prefix}/${dim}:${id}`;
    const spend = sum(rows, (r) => r.spend);
    const rev = sum(rows, (r) => r.rev);
    const geo = new Map();
    for (const r of rows) if (r.campaign) addGeo(geo, state.model.campGeo.get(r.key));
    const node = {
      path, dim, id, depth, rows, spend, rev, roas: roas(rev, spend), geo,
      linkedOnly: rows.every((r) => r.linked),
    };
    if (dim === 'campaign') {
      node.fact = rows[0];
      node.children = rows[0].campaign ? creativeNodes(rows[0], path, depth + 1) : [];
    } else {
      node.children = buildLevelTree(rows, dims, depth + 1, path);
    }
    nodes.push(node);
  }
  return nodes;
}

function levelName(n) {
  switch (n.dim) {
    case 'bc': return bcName(n.id);
    case 'account': return accName(n.id);
    case 'app': return appName(n.id);
    case 'campaign': return n.fact?.campaign_name || n.id;
    default: return n.label;
  }
}

function levelLabel(n) {
  switch (n.dim) {
    case 'bc': return `${esc(bcName(n.id))} <span class="count">BC ${esc(n.id)}</span>`;
    case 'account': {
      const a = state.model.accounts.get(n.id) || {};
      return `${esc(a.name || n.id)} <span class="count">${esc(n.id)} · ${esc(a.timezone || '')}${a.currency && a.currency !== 'USD' ? ' · ' + esc(a.currency) : ''}</span>`;
    }
    case 'app': return `${appLabel(n.id)} <span class="count">${n.id === NONE_APP ? '' : esc(n.id)}</span>`;
    case 'campaign': return `<span class="name" title="${esc(levelName(n))} (${esc(n.fact?.campaign || '')})">${esc(levelName(n))}</span>`;
    default: return `<span class="name ${n.muted ? 'muted' : ''}" title="${esc(n.label)}">${esc(n.label)}</span>${n.ads > 1 ? ` <span class="count">${n.ads} ads</span>` : ''}`;
  }
}

function subLabel(n) {
  if (!n.children.length) return '';
  return `${n.children.length} ${DIMS[n.children[0].dim].toLowerCase()}`;
}

function statusCell(n) {
  const thr = state.config.budgetHitThreshold;
  if (n.dim === 'creative') return '';
  if (n.dim === 'campaign') {
    const f = n.fact;
    if (!f.campaign) return '<span class="tag">Event Manager</span>';
    const tag = f.maxPct != null && f.maxPct >= thr ? ` <span class="tag hit" title="Chạm ${f.hitDays} ngày">Max budget</span>` : '';
    return `<span class="tag ${f.status === 'ENABLE' ? 'run' : ''}">${esc(f.status || '–')}</span>${tag}`;
  }
  const hit = n.rows.filter((r) => r.campaign && r.hitDays > 0).length;
  const hitTag = hit ? ` <span class="tag hit" title="Số campaign chạm max budget">${hit} max budget</span>` : '';
  if (n.spend > 0) return `<span class="tag run">Đang chạy</span>${hitTag}`;
  return n.linkedOnly ? '<span class="tag">Link EM, chưa spend</span>' : '<span class="tag">0 spend</span>';
}

function isOpen(n, searching) {
  if (state.openOverrides.has(n.path)) return state.openOverrides.get(n.path);
  return searching || n.depth < state.expandTo;
}

function renderLevels() {
  // chips
  $('#midLevels').innerHTML = state.midOrder.map((d) => `<span class="chip" data-dim="${d}">${DIMS[d]}</span>`).join('<span class="arrow">→</span>');
  $$('#sortSeg button').forEach((b) => b.classList.toggle('active', b.dataset.sort === state.lvSort.key));
  $('#sortDir').textContent = state.lvSort.dir === 'desc' ? '↓ Cao → thấp' : '↑ Thấp → cao';

  const el = $('#pivotTable');
  const dims = levelDims();
  const tree = buildLevelTree(levelFacts(), dims);
  const minSpend = Number($('#minSpendLv').value) || 0;
  const searching = $('#pivotSearch').value.trim() !== '';
  const { key, dir } = state.lvSort;
  const sortNodes = (nodes) => nodes
    .filter((n) => n.spend >= minSpend || (minSpend === 0))
    .sort((a, b) => cmpVals(a[key], b[key], dir) || cmpVals(a.spend, b.spend, 'desc'));

  const grand = sum(tree, (n) => n.spend);
  const out = [];
  const walk = (nodes, parentSpend) => {
    for (const n of sortNodes(nodes)) {
      const open = n.children.length && isOpen(n, searching);
      const tog = n.children.length ? `<span class="toggle">${open ? '▾' : '▸'}</span>` : '<span class="toggle"></span>';
      const share = parentSpend > 0 ? n.spend / parentSpend : 0;
      out.push(`<tr class="lvl${n.depth} dim-${n.dim}" data-path="${esc(n.path)}">
        <td class="l"><span class="indent" style="width:${n.depth * 22}px"></span>${tog}<span class="lvtag">${DIMS[n.dim]}</span>${levelLabel(n)}${n.dim !== 'creative' ? `<button class="focusbtn" title="Lọc dashboard theo dòng này">🎯</button>` : ''}</td>
        <td class="muted">${subLabel(n)}</td>
        <td><span class="bar" style="width:${Math.max(2, share * 60)}px" title="${pct(share, 0)} spend của level trên"></span>${money(n.spend)}</td>
        <td>${roasCell(n.roas)}</td>
        <td class="l">${topGeoCell(n.geo, n.spend)}</td>
        <td class="l">${statusCell(n)}</td>
      </tr>`);
      if (open) walk(n.children, n.spend);
    }
  };
  walk(tree, grand);

  const th = (k, label, cls = '') => `<th data-key="${k}" class="${cls} ${key === k ? 'sorted ' + dir : ''}">${label}</th>`;
  el.innerHTML = `<thead><tr>${th('name', dims.map((d) => DIMS[d]).join(' → '), 'l')}<th>Xổ ra</th>${th('spend', 'Spend')}${th('roas', 'ROAS IAA D0')}<th class="l">Top geo</th><th class="l">Trạng thái</th></tr></thead>` +
    `<tbody>${out.join('') || '<tr><td colspan="6" class="muted l">Không có dữ liệu</td></tr>'}</tbody>`;

  el.querySelectorAll('thead th[data-key]').forEach((h) => h.addEventListener('click', () => {
    const k = h.dataset.key;
    if (k === 'name') return;
    setLvSort(k, state.lvSort.key === k && state.lvSort.dir === 'desc' ? 'asc' : 'desc');
  }));

  const byPath = new Map();
  const index = (nodes) => nodes.forEach((n) => { byPath.set(n.path, n); index(n.children); });
  index(tree);
  el.querySelectorAll('tbody tr[data-path]').forEach((tr) => tr.addEventListener('click', (e) => {
    const n = byPath.get(tr.dataset.path);
    if (!n) return;
    if (e.target.closest('.focusbtn')) { applyFocusFromNode(n); return; }
    if (!n.children.length) return;
    state.openOverrides.set(n.path, !isOpen(n, searching));
    renderLevels();
  }));
}

function setLvSort(key, dir) {
  state.lvSort = { key, dir };
  LS.set('lvSort', state.lvSort);
  renderLevels();
}

function applyFocusFromNode(n) {
  const focus = { bc: null, account: null, app: null };
  for (const seg of n.path.split('/').filter(Boolean)) {
    const i = seg.indexOf(':');
    const dim = seg.slice(0, i), id = seg.slice(i + 1);
    if (dim in focus) focus[dim] = id;
  }
  if (n.dim === 'campaign' && n.fact) { focus.bc = n.fact.bc; focus.account = n.fact.account; focus.app = n.fact.app; }
  state.focus = focus;
  renderAll();
}

function initLevels() {
  Sortable.create($('#midLevels'), {
    animation: 150,
    draggable: '.chip',
    onEnd: () => {
      const order = [...$('#midLevels').querySelectorAll('.chip')].map((c) => c.dataset.dim);
      setMidOrder(order);
    },
  });
  $('#swapLevels').addEventListener('click', () => setMidOrder([...state.midOrder].reverse()));
  $$('#sortSeg button').forEach((b) => b.addEventListener('click', () => setLvSort(b.dataset.sort, state.lvSort.dir)));
  $('#sortDir').addEventListener('click', () => setLvSort(state.lvSort.key, state.lvSort.dir === 'desc' ? 'asc' : 'desc'));
  $('#expandTo').addEventListener('change', (e) => { state.expandTo = Number(e.target.value); state.openOverrides.clear(); renderLevels(); });
  ['#pivotSearch', '#minSpendLv', '#creativeGroupLv', '#showLinkedOnly'].forEach((s) => $(s).addEventListener('input', () => state.model && renderLevels()));
}

function setMidOrder(order) {
  state.midOrder = order;
  state.openOverrides.clear();
  LS.set('midOrder', order);
  renderLevels();
}

// ---------- overview ----------
function renderOverview() {
  const camps = filteredCampaigns();
  const spend = sum(camps, (f) => f.spend);
  const rev = sum(camps, (f) => f.rev);
  const accs = new Set(camps.filter((f) => f.spend > 0).map((f) => f.account));
  const apps = new Set(camps.filter((f) => f.spend > 0 && f.app !== NONE_APP).map((f) => f.app));
  const hits = state.model.hits.filter((h) => inFocus(h.bc, h.account, h.app));
  $('#kpis').innerHTML = [
    ['Spend', money(spend), ''],
    ['IAA revenue D0', money(rev), ''],
    ['ROAS IAA D0', pct(roas(rev, spend)), ''],
    ['App đang chạy', int(apps.size), `${accs.size} account có spend`],
    ['Chạm max budget', int(hits.length), 'campaign/ad group-ngày'],
  ].map(([l, v, s]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join('');

  const day = new Map();
  const geo = new Map();
  for (const f of camps) addGeo(geo, state.model.campGeo.get(f.key));
  for (const adv of state.data.advertisers) {
    for (const r of adv.campaignDaily) {
      const app = state.model.campApp.get(`${adv.advertiser_id}|${r.campaign_id}`) || NONE_APP;
      if (!inFocus(adv.bc_id, adv.advertiser_id, app)) continue;
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

  const topGeo = [...geo.entries()].sort((a, b) => b[1].spend - a[1].spend).slice(0, 12);
  setChart('geoChart', {
    type: 'bar',
    data: { labels: topGeo.map(([c]) => c), datasets: [{ label: 'Spend', data: topGeo.map(([, e]) => e.spend), backgroundColor: c1, borderRadius: { topRight: 4, bottomRight: 4 }, maxBarThickness: 22 }] },
    options: {
      ...baseOpts(), indexAxis: 'y',
      scales: { x: { beginAtZero: true, ticks: { callback: (v) => money(v) } }, y: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const e = topGeo[c.dataIndex][1]; return [`Spend ${money(e.spend)} (${pct(e.spend / (spend || 1))})`, `ROAS IAA D0 ${pct(roas(e.rev, e.spend))}`]; } } } },
    },
  });

  const top = [...camps].sort((a, b) => b.spend - a.spend).slice(0, 10);
  const maxSpend = top[0]?.spend || 1;
  renderTable($('#topCampTable'), [
    { key: 'campaign_name', label: 'Campaign', cls: 'l name', fmt: (r) => `<span title="${esc(r.campaign_name)}">${esc(r.campaign_name)}</span>` },
    { key: 'app', label: 'App', cls: 'l name', fmt: (r) => esc(appName(r.app)), sort: (r) => appName(r.app) },
    { key: 'spend', label: 'Spend', fmt: (r) => `<span class="bar" style="width:${Math.max(2, (r.spend / maxSpend) * 60)}px"></span>${money(r.spend)}` },
    { key: 'roas', label: 'ROAS D0', fmt: (r) => roasCell(roas(r.rev, r.spend)), sort: (r) => roas(r.rev, r.spend) },
    { key: 'geo', label: 'Top geo', cls: 'l', fmt: (r) => topGeoCell(state.model.campGeo.get(r.key), r.spend), sort: () => 0 },
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

// ---------- campaigns ----------
function renderCampaigns() {
  $('#thr').textContent = pct(state.config.budgetHitThreshold, 0);
  renderTable($('#campTable'), [
    { key: 'campaign_name', label: 'Campaign', cls: 'l name', fmt: (r) => `<span title="${esc(r.campaign_name)} (${esc(r.campaign)})">${esc(r.campaign_name)}</span>` },
    { key: 'account', label: 'Account', cls: 'l name', fmt: (r) => esc(accName(r.account)), sort: (r) => accName(r.account) },
    { key: 'app', label: 'App', cls: 'l name', fmt: (r) => esc(appName(r.app)), sort: (r) => appName(r.app) },
    { key: 'status', label: 'Status', cls: 'l', fmt: (r) => `<span class="tag ${r.status === 'ENABLE' ? 'run' : ''}">${esc(r.status || '–')}</span>` },
    { key: 'budget', label: 'Budget ngày', fmt: (r) => (r.budget ? `${money(r.budget)} <span class="count">${esc(r.budgetLevel)}</span>` : '<span class="muted">không giới hạn</span>') },
    { key: 'spend', label: 'Spend', fmt: (r) => money(r.spend) },
    { key: 'roas', label: 'ROAS IAA D0', fmt: (r) => roasCell(roas(r.rev, r.spend)), sort: (r) => roas(r.rev, r.spend) },
    { key: 'geo', label: 'Top geo', cls: 'l', fmt: (r) => topGeoCell(state.model.campGeo.get(r.key), r.spend), sort: () => 0 },
    { key: 'maxPct', label: 'Max % budget/ngày', fmt: budgetTag },
    { key: 'hitDays', label: 'Số ngày chạm max', fmt: (r) => (r.hitDays ? `<span class="tag hit">${r.hitDays}</span>` : '') },
  ], filteredCampaigns(), { defaultSort: { key: 'spend', dir: 'desc' } });

  const hits = state.model.hits.filter((h) => inFocus(h.bc, h.account, h.app));
  renderTable($('#hitTable'), hitColumns(), hits, { defaultSort: { key: 'date', dir: 'desc' } });
}

// ---------- creatives (cross-campaign) ----------
function renderCreatives() {
  const mode = $('#creativeGroup').value;
  const minSpend = Number($('#minSpend').value) || 0;
  const q = $('#creativeSearch').value.trim().toLowerCase();
  const groups = new Map();
  for (const adv of state.data.advertisers) {
    for (const ad of adv.ads) {
      const app = ad.app_id || state.model.campApp.get(`${adv.advertiser_id}|${ad.campaign_id}`) || NONE_APP;
      if (!inFocus(adv.bc_id, adv.advertiser_id, app)) continue;
      const k = creativeKey(ad.ad_name, mode) || ad.ad_id;
      const g = groups.get(k) || { name: k, spend: 0, rev: 0, ads: 0, apps: new Set(), geo: new Map() };
      g.spend += ad.spend; g.rev += ad.rev; g.ads++;
      g.apps.add(app);
      addGeo(g.geo, state.model.adGeo.get(`${adv.advertiser_id}|${ad.ad_id}`));
      groups.set(k, g);
    }
  }
  const rows = [...groups.values()].filter((g) => g.spend >= minSpend && (!q || g.name.toLowerCase().includes(q)));
  rows.forEach((g) => { g.roas = roas(g.rev, g.spend); });

  renderTable($('#creativeTable'), [
    { key: 'name', label: 'Creative', cls: 'l name', fmt: (r) => `<span title="${esc(r.name)}">${esc(r.name)}</span>` },
    { key: 'apps', label: 'App', cls: 'l name', fmt: (r) => esc([...r.apps].map(appName).join(', ')), sort: (r) => [...r.apps].map(appName).join(',') },
    { key: 'ads', label: '#Ads', fmt: (r) => int(r.ads) },
    { key: 'spend', label: 'Spend', fmt: (r) => money(r.spend) },
    { key: 'roas', label: 'ROAS IAA D0', fmt: (r) => roasCell(r.roas) },
    { key: 'geo', label: 'Top geo', cls: 'l', fmt: (r) => topGeoCell(r.geo, r.spend), sort: () => 0 },
  ], rows, { defaultSort: { key: 'spend', dir: 'desc' } });

  const top = [...rows].sort((a, b) => b.spend - a.spend).slice(0, 60);
  setChart('creativeChart', {
    type: 'scatter',
    data: { datasets: [{ label: 'Creative', data: top.map((g) => ({ x: g.spend, y: g.roas ?? 0, g })), backgroundColor: cssVar('--series-1') + 'b3', borderColor: cssVar('--surface'), borderWidth: 2, pointRadius: 6, pointHoverRadius: 9 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const g = c.raw.g; return [g.name.slice(0, 60), `Spend ${money(g.spend)} · ROAS ${pct(g.roas)}`]; } } } },
      scales: {
        x: { title: { display: true, text: 'Spend' }, beginAtZero: true, ticks: { callback: (v) => money(v) } },
        y: { title: { display: true, text: 'ROAS IAA D0' }, beginAtZero: true, ticks: { callback: (v) => pct(v, 0) } },
      },
    },
  });
}

// ---------- BC picker ----------
function renderBcPicker() {
  const sel = new Set(state.selectedBcs);
  $('#bcBtn').textContent = sel.size === 1 ? `BC: ${bcName([...sel][0])} ▾` : `BC: ${sel.size}/${state.bcs.length} đã chọn ▾`;
  const q = $('#bcSearch').value.trim().toLowerCase();
  $('#bcList').innerHTML = state.bcs
    .filter((b) => !q || b.name.toLowerCase().includes(q) || b.bc_id.includes(q))
    .map((b) => `<label class="bcitem"><input type="checkbox" value="${esc(b.bc_id)}" ${sel.has(b.bc_id) ? 'checked' : ''}> <span>${esc(b.name)}</span> <span class="count">${esc(b.bc_id)}${b.status && b.status !== 'ENABLE' ? ' · ' + esc(b.status) : ''}</span></label>`)
    .join('');
}

function initBcPicker() {
  const panel = $('#bcPanel');
  let draft = null;
  const visibleIds = () => $$('#bcList input').map((i) => i.value);
  $('#bcBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { draft = new Set(state.selectedBcs); $('#bcSearch').focus(); }
  });
  panel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { panel.hidden = true; });
  $('#bcList').addEventListener('change', (e) => {
    if (e.target.checked) draft.add(e.target.value); else draft.delete(e.target.value);
  });
  const sync = () => { const keep = state.selectedBcs; state.selectedBcs = [...draft]; renderBcPicker(); state.selectedBcs = keep; };
  $('#bcSearch').addEventListener('input', sync);
  $('#bcAll').addEventListener('click', () => { visibleIds().forEach((id) => draft.add(id)); sync(); });
  $('#bcNone').addEventListener('click', () => { draft.clear(); sync(); });
  $('#bcApply').addEventListener('click', () => {
    if (!draft.size) return;
    state.selectedBcs = [...draft];
    LS.set('selectedBcs', state.selectedBcs);
    state.focus = { bc: null, account: null, app: null };
    state.openOverrides.clear();
    panel.hidden = true;
    renderBcPicker();
    load();
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
  if (!state.selectedBcs.length) return;
  const seq = ++loadSeq;
  const qs = new URLSearchParams({ bc_ids: state.selectedBcs.join(','), preset: state.preset, include_today: state.includeToday ? '1' : '0' });
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

  $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${b.dataset.tab}`));
    Object.values(state.charts).forEach((c) => c.resize());
  }));

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

  initLevels();
  initBcPicker();
  ['#creativeGroup', '#minSpend', '#creativeSearch'].forEach((s) => $(s).addEventListener('input', () => state.model && renderCreatives()));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { chartDefaults(); renderAll(); });

  try {
    const { bcs } = await api('/api/bcs');
    state.bcs = bcs;
    state.selectedBcs = state.selectedBcs.filter((id) => bcs.some((b) => b.bc_id === id));
    if (!state.selectedBcs.length && bcs[0]) state.selectedBcs = [bcs[0].bc_id];
    renderBcPicker();
    load();
  } catch (e) {
    $('#status').innerHTML = `<span class="err">Không tải được danh sách BC: ${esc(e.message)}</span>`;
  }
}

init();
