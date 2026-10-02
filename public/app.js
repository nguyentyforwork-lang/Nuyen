const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let TZ = 'Asia/Ho_Chi_Minh';
const selected = new Set();

const STATUS_LABEL = {
  STATUS_ENABLE: ['Hoạt động', 'ok'], STATUS_LIMIT: ['Bị hạn chế (punish)', 'danger'], STATUS_DISABLE: ['Bị vô hiệu hoá', 'danger'],
  STATUS_CONFIRM_FAIL: ['Duyệt thất bại', 'danger'], STATUS_CONFIRM_FAIL_END: ['Duyệt thất bại (cuối)', 'danger'],
  STATUS_PENDING_CONFIRM: ['Chờ duyệt', ''], STATUS_PENDING_VERIFIED: ['Chờ xác minh', ''],
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }) : '');
const dayStr = (offset) => new Date(Date.now() - offset * 86400000).toLocaleDateString('sv-SE', { timeZone: TZ });

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg, ms = 4000) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms);
}

async function withBusy(btn, fn) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Đang chạy…';
  try { await fn(); } catch (e) { toast('Lỗi: ' + e.message, 7000); } finally { btn.disabled = false; btn.textContent = label; refreshStatus(); }
}

// ===== Status =====
async function refreshStatus() {
  const s = await api('/api/status');
  TZ = s.tz;
  $('#cAccounts').textContent = s.counts.accounts; $('#cSuspended').textContent = s.counts.suspended;
  $('#cRejected').textContent = s.counts.rejected; $('#cPending').textContent = s.counts.pendingAutoAppeal;
  const rs = $('#runState');
  rs.textContent = s.running ? `Đang ${s.running}…` : s.nextRunAt ? `Lần quét tới: ${fmtDate(s.nextRunAt)}` : 'Không tự quét';
  rs.classList.toggle('busy', !!s.running);
  const b = $('#banner');
  if (s.mock) { b.textContent = 'Đang chạy chế độ MOCK (dữ liệu giả). Điền token vào .env và đặt MOCK=0 để dùng dữ liệu thật.'; b.classList.remove('hidden'); }
  else if (!s.configured) { b.textContent = 'Chưa cấu hình TIKTOK_ACCESS_TOKEN trong file .env.'; b.classList.remove('hidden'); }
  else b.classList.add('hidden');
  $('#scanRows').innerHTML = s.lastScans.map((x) => `<tr><td>${fmtDate(x.at)}</td><td>${x.type === 'accounts' ? 'Account' : 'Creative'}</td><td>${
    x.type === 'accounts' ? `${x.total} account, ${x.suspended} đang suspend, ${x.newlySuspended} mới`
      : `${x.accounts} account, ${x.rejected} creative bị từ chối (${x.newRejected} mới)${x.errors.length ? `, <span class="badge danger">${x.errors.length} lỗi</span>` : ''}`
  }</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Chưa quét lần nào</td></tr>';
}

// ===== Accounts =====
const accQuery = () => new URLSearchParams({ from: $('#accFrom').value, to: $('#accTo').value, view: $('#accView').value, q: $('#accQ').value });
async function loadAccounts() {
  const rows = await api('/api/accounts?' + accQuery());
  $('#accRows').innerHTML = rows.map((a) => {
    const [label, cls] = STATUS_LABEL[a.status] || [a.status, ''];
    return `<tr>
      <td class="mono">${esc(a.advertiser_id)}</td>
      <td>${esc(a.name)}<div class="sub">${esc(a.company || '')}</div></td>
      <td><span class="badge ${cls}">${esc(label)}</span>${a.reactivated_at ? `<div class="sub">Mở lại ${fmtDate(a.reactivated_at)}</div>` : ''}</td>
      <td>${esc(a.rejection_reason || '')}</td>
      <td>${a.suspended_at ? (a.suspended_at_estimated ? '≈ ' : '') + fmtDate(a.suspended_at) : ''}</td>
      <td>${esc(a.balance ?? '')} ${esc(a.currency || '')}</td>
      <td><a href="https://ads.tiktok.com/i18n/dashboard?aadvid=${encodeURIComponent(a.advertiser_id)}" target="_blank" rel="noopener">Ads Manager</a></td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="empty">Không có account nào. Bấm "Quét account" để kéo dữ liệu.</td></tr>';
}

// ===== Creatives =====
const crQuery = () => new URLSearchParams({ from: $('#crFrom').value, to: $('#crTo').value, state: $('#crState').value, appeal: $('#crAppeal').value, q: $('#crQ').value });
function appealCell(c) {
  const ok = (c.appeals || []).filter((a) => a.ok);
  const last = (c.appeals || []).at(-1);
  let html = c.appeal_status ? `<span class="badge ${/SUCCESS|PASS/.test(c.appeal_status) ? 'ok' : /FAIL|REJECT/.test(c.appeal_status) ? 'danger' : ''}">${esc(c.appeal_status)}</span>` : '';
  if (ok.length) html += `<div class="sub">${ok.length} lần, gần nhất ${fmtDate(ok.at(-1).at)}</div>`;
  if (last && !last.ok) html += `<div class="sub" style="color:var(--danger)">${esc(last.error)}</div>`;
  return html || '<span class="sub">Chưa appeal</span>';
}
async function loadCreatives() {
  const rows = await api('/api/creatives?' + crQuery());
  const ids = new Set(rows.map((r) => r.ad_id));
  for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
  $('#crRows').innerHTML = rows.map((c) => `<tr>
      <td><input type="checkbox" class="crPick" value="${esc(c.ad_id)}" ${selected.has(c.ad_id) ? 'checked' : ''} ${c.state !== 'rejected' ? 'disabled' : ''}></td>
      <td>${esc(c.ad_name)}<div class="sub mono">${esc(c.ad_id)}</div>${c.ad_text ? `<div class="sub">${esc(c.ad_text)}</div>` : ''}</td>
      <td>${esc(c.advertiser_name)}<div class="sub mono">${esc(c.advertiser_id)}</div></td>
      <td>${esc(c.campaign_name)}<div class="sub">${esc(c.adgroup_name)}</div></td>
      <td>${(c.reject_reasons || []).map((r) => `<div>${esc(r.reason)}${r.suggestion ? `<div class="sub">${esc(r.suggestion)}</div>` : ''}</div>`).join('') || `<span class="badge">${esc(c.secondary_status)}</span>`}</td>
      <td>${fmtDate(c.detected_at)}${c.resolved_at ? `<div class="sub">Hết vi phạm ${fmtDate(c.resolved_at)}</div>` : ''}</td>
      <td>${appealCell(c)}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">Không có creative nào. Bấm "Quét creative" để kéo dữ liệu.</td></tr>';
  $('#crAll').checked = false;
  updateAppealBtn();
}
function updateAppealBtn() { const b = $('#btnAppeal'); b.textContent = `Appeal đã chọn (${selected.size})`; b.disabled = !selected.size; }

// ===== Log & settings =====
async function loadLog() {
  const rows = await api('/api/appeal-log');
  $('#logRows').innerHTML = rows.map((l) => `<tr><td>${fmtDate(l.at)}</td><td>${esc(l.ad_name)}<div class="sub mono">${esc(l.ad_id)}</div></td>
    <td class="mono">${esc(l.advertiser_id)}</td><td>${l.auto ? 'Tự động' : 'Thủ công'}</td>
    <td>${l.ok ? '<span class="badge ok">Đã gửi</span>' : `<span class="badge danger">Lỗi</span> <span class="sub">${esc(l.error)}</span>`}</td></tr>`).join('')
    || '<tr><td colspan="5" class="empty">Chưa có appeal nào</td></tr>';
}
async function loadSettings() {
  const s = await api('/api/settings'); const f = $('#settingsForm');
  for (const [k, v] of Object.entries(s)) { const el = f.elements[k]; if (!el) continue; if (el.type === 'checkbox') el.checked = v; else el.value = v; }
}

const loaders = { accounts: loadAccounts, creatives: loadCreatives, log: loadLog, settings: loadSettings };
const reload = () => Promise.all([refreshStatus(), loaders[$('.tabs .active').dataset.tab]()]).catch((e) => toast('Lỗi: ' + e.message));

// ===== Events =====
$$('.tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  reload();
}));
function bindRange(attr, fromEl, toEl, load) {
  $$(`[${attr}]`).forEach((b) => b.addEventListener('click', () => {
    const v = b.getAttribute(attr);
    if (v === '') { fromEl.value = ''; toEl.value = ''; }
    else if (v === '1') { fromEl.value = toEl.value = dayStr(1); }
    else { fromEl.value = dayStr(Number(v)); toEl.value = dayStr(0); }
    load();
  }));
}
bindRange('data-acc-range', $('#accFrom'), $('#accTo'), loadAccounts);
bindRange('data-cr-range', $('#crFrom'), $('#crTo'), loadCreatives);
['#accFrom', '#accTo', '#accView'].forEach((s) => $(s).addEventListener('change', loadAccounts));
['#crFrom', '#crTo', '#crState', '#crAppeal'].forEach((s) => $(s).addEventListener('change', loadCreatives));
let debounce; $('#accQ').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(loadAccounts, 250); });
$('#crQ').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(loadCreatives, 250); });

$('#crRows').addEventListener('change', (e) => {
  if (!e.target.classList.contains('crPick')) return;
  e.target.checked ? selected.add(e.target.value) : selected.delete(e.target.value); updateAppealBtn();
});
$('#crAll').addEventListener('change', (e) => {
  $$('.crPick:not(:disabled)').forEach((cb) => { cb.checked = e.target.checked; e.target.checked ? selected.add(cb.value) : selected.delete(cb.value); });
  updateAppealBtn();
});

$('#btnFullScan').addEventListener('click', (e) => withBusy(e.target, async () => {
  const r = await api('/api/scan/full', { method: 'POST' });
  toast(`Xong: ${r.accounts.suspended} account suspend, ${r.creatives.rejected} creative bị từ chối${r.appeals ? `, đã auto appeal ${r.appeals.ok}` : ''}`);
  await reload();
}));
$('#btnScanAcc').addEventListener('click', (e) => withBusy(e.target, async () => {
  const r = await api('/api/scan/accounts', { method: 'POST' });
  toast(`Đã quét ${r.total} account – ${r.newlySuspended} account mới bị suspend`); await loadAccounts();
}));
$('#btnScanCr').addEventListener('click', (e) => withBusy(e.target, async () => {
  const r = await api('/api/scan/creatives', { method: 'POST', body: {} });
  toast(`Đã quét ${r.accounts} account – ${r.rejected} creative bị từ chối (${r.newRejected} mới)${r.errors.length ? `, ${r.errors.length} lỗi` : ''}`); await loadCreatives();
}));
$('#btnAppeal').addEventListener('click', (e) => {
  if (!confirm(`Gửi appeal cho ${selected.size} creative?`)) return;
  withBusy(e.target, async () => {
    const r = await api('/api/appeal', { method: 'POST', body: { ad_ids: [...selected], reason: $('#appealReason').value } });
    toast(`Đã gửi ${r.ok}/${r.total} appeal`); selected.clear(); await loadCreatives();
  });
});
$('#btnExportAcc').addEventListener('click', () => { location.href = '/api/export/accounts.csv?' + accQuery(); });
$('#btnExportCr').addEventListener('click', () => { location.href = '/api/export/creatives.csv?' + crQuery(); });
$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = e.target;
  const body = { autoScan: f.autoScan.checked, autoAppeal: f.autoAppeal.checked, scanIntervalMinutes: +f.scanIntervalMinutes.value,
    maxAppealsPerRun: +f.maxAppealsPerRun.value, maxAppealsPerAd: +f.maxAppealsPerAd.value, appealReason: f.appealReason.value };
  if (body.autoAppeal && !confirm('Bật auto appeal: hệ thống sẽ tự gửi appeal cho creative bị từ chối sau mỗi lần quét. Tiếp tục?')) return;
  try { await api('/api/settings', { method: 'POST', body }); toast('Đã lưu cài đặt'); refreshStatus(); } catch (err) { toast('Lỗi: ' + err.message); }
});

reload();
setInterval(refreshStatus, 15000);
