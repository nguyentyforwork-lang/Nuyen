const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
let TZ = 'Asia/Ho_Chi_Minh';
let templates = [];
const groupsData = { suspended: [], active: [] };
const selected = { suspended: new Set(), active: new Set(), ads: new Set() };
const expanded = new Set();

const STATUS_LABEL = {
  STATUS_ENABLE: ['Hoạt động', 'ok'], STATUS_LIMIT: ['Bị hạn chế (punish)', 'danger'], STATUS_DISABLE: ['Bị vô hiệu hoá', 'danger'],
  STATUS_CONFIRM_FAIL: ['Duyệt thất bại', 'danger'], STATUS_CONFIRM_FAIL_END: ['Duyệt thất bại (cuối)', 'danger'],
  STATUS_PENDING_CONFIRM: ['Chờ duyệt', ''], STATUS_PENDING_VERIFIED: ['Chờ xác minh', ''],
};
const APPEAL_STATE = { none: ['Chưa appeal', 'danger'], pending: ['Đang xét', ''], sent: ['Đã appeal', 'ok'], failed: ['Appeal lỗi / bị từ chối', 'danger'] };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }) : '');
const dayStr = (offset) => new Date(Date.now() - offset * 86400000).toLocaleDateString('sv-SE', { timeZone: TZ });
const statusBadge = (s) => { const [l, c] = STATUS_LABEL[s] || [s, '']; return `<span class="badge ${c}">${esc(l)}</span>`; };
const adsManager = (id) => `https://ads.tiktok.com/i18n/dashboard?aadvid=${encodeURIComponent(id)}`;

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
  try { await fn(); } catch (e) { toast('Lỗi: ' + e.message, 7000); } finally { btn.textContent = label; btn.disabled = false; refreshStatus(); updateActionBars(); }
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Đã copy'); } catch { prompt('Copy nội dung:', text); }
}

// ===== Status & job =====
let jobPoll = null;
async function refreshStatus() {
  const s = await api('/api/status');
  TZ = s.tz;
  $('#cAccounts').textContent = s.counts.accounts; $('#cSuspended').textContent = s.counts.suspended;
  $('#cActiveViol').textContent = s.counts.activeWithViolations; $('#cRejected').textContent = s.counts.rejected;
  const rs = $('#runState');
  rs.textContent = s.running ? `Đang ${s.running}…` : s.nextRunAt ? `Lần quét tới: ${fmtDate(s.nextRunAt)}` : 'Không tự quét';
  rs.classList.toggle('busy', !!s.running);
  const b = $('#banner');
  if (s.mock) { b.textContent = 'Đang chạy chế độ MOCK (dữ liệu giả). Điền token vào .env và đặt MOCK=0 để dùng dữ liệu thật.'; b.classList.remove('hidden'); }
  else if (!s.configured) { b.textContent = 'Chưa cấu hình TIKTOK_ACCESS_TOKEN trong file .env.'; b.classList.remove('hidden'); }
  else b.classList.add('hidden');
  renderJob(s.job);
  if (s.job && s.job.status === 'running') startJobPoll();
  $('#scanRows').innerHTML = s.lastScans.map((x) => `<tr><td>${fmtDate(x.at)}</td><td>${x.type === 'accounts' ? 'Account' : 'Creative'}</td><td>${
    x.type === 'accounts' ? `${x.total} account, ${x.suspended} đang suspend, ${x.newlySuspended} mới`
      : `${x.accounts} account, ${x.rejected} creative bị từ chối (${x.newRejected} mới)${x.errors.length ? `, <span class="badge danger" title="${esc(x.errors.map((e) => e.advertiser_id + ': ' + e.error).join('\n'))}">${x.errors.length} lỗi</span>` : ''}`
  }</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Chưa quét lần nào</td></tr>';
}
function renderJob(job) {
  const bar = $('#jobBar');
  if (!job || (job.status === 'done' && Date.now() - new Date(job.finishedAt) > 60000)) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('#jobTitle').textContent = job.status === 'running' ? 'Đang bulk appeal…' : 'Bulk appeal xong';
  $('#jobText').textContent = `${job.done}/${job.total} creative trên ${job.accounts} account · thành công ${job.ok} · lỗi ${job.failed}${job.skipped ? ` · bỏ qua ${job.skipped}` : ''}`;
  $('#jobFill').style.width = (job.total ? (job.done / job.total) * 100 : 0) + '%';
}
function startJobPoll() {
  if (jobPoll) return;
  jobPoll = setInterval(async () => {
    const job = await api('/api/appeal/job').catch(() => null);
    renderJob(job);
    if (!job || job.status !== 'running') {
      clearInterval(jobPoll); jobPoll = null;
      if (job) toast(`Bulk appeal xong: ${job.ok}/${job.total} thành công${job.failed ? `, ${job.failed} lỗi (xem Lịch sử appeal)` : ''}`, 8000);
      reload();
    }
  }, 1000);
}

// ===== Group views (luồng ① và ②) =====
function groupQuery(type) {
  const q = new URLSearchParams({ type });
  if (type === 'suspended') { q.set('from', $('#susFrom').value); q.set('to', $('#susTo').value); q.set('q', $('#susQ').value); }
  else q.set('q', $('#actQ').value);
  return q;
}
function progressSteps(a, type) {
  const s = a.summary;
  const checked = !!a.creatives_checked_at;
  const steps = [`<span class="step ${checked ? 'done' : 'todo'}" title="${checked ? 'Kiểm tra lúc ' + fmtDate(a.creatives_checked_at) : ''}">${checked ? '✓' : '•'} Kiểm tra</span>`];
  const appealDone = checked && s.none === 0 && s.failed === 0;
  steps.push(`<span class="step ${!checked ? '' : appealDone ? 'done' : 'todo'}">${appealDone ? '✓' : '•'} Appeal creative${s.total ? ` ${s.total - s.none - s.failed}/${s.total}` : ''}</span>`);
  if (type === 'suspended') steps.push(`<span class="step ${a.account_appealed_at ? 'done' : 'todo'}" title="${fmtDate(a.account_appealed_at)}">${a.account_appealed_at ? '✓' : '•'} Appeal account</span>`);
  return `<div class="steps">${steps.join('')}</div>`;
}
function summaryChips(s, checked) {
  if (!checked) return '<span class="sub">Chưa kiểm tra</span>';
  if (!s.total) return '<span class="badge ok">Không có creative vi phạm</span>';
  return `<div class="chips"><span class="badge info">${s.total} vi phạm</span>${s.none ? `<span class="badge danger">${s.none} chưa appeal</span>` : ''}${s.pending ? `<span class="badge">${s.pending} đang xét</span>` : ''}${s.sent ? `<span class="badge ok">${s.sent} đã appeal</span>` : ''}${s.failed ? `<span class="badge danger">${s.failed} lỗi</span>` : ''}</div>`;
}
function creativeTable(list) {
  if (!list.length) return '<div class="empty">Không có creative vi phạm</div>';
  return `<table><thead><tr><th>Ad</th><th>Campaign / Adgroup</th><th>Lý do vi phạm</th><th>Appeal</th></tr></thead><tbody>${list.map((c) => {
    const [l, cls] = APPEAL_STATE[c.appeal_state] || ['', ''];
    const last = (c.appeals || []).at(-1);
    return `<tr><td>${esc(c.ad_name)}<div class="sub mono">${esc(c.ad_id)}</div></td><td>${esc(c.campaign_name)}<div class="sub">${esc(c.adgroup_name)}</div></td>
      <td>${(c.reject_reasons || []).map((r) => `<div>${esc(r.reason)}${r.suggestion ? `<div class="sub">${esc(r.suggestion)}</div>` : ''}</div>`).join('') || `<span class="badge">${esc(c.secondary_status)}</span>`}</td>
      <td><span class="badge ${cls}">${l}</span>${last ? `<div class="sub">${fmtDate(last.at)}</div>` : ''}${last && !last.ok ? `<div class="sub" style="color:var(--danger)">${esc(last.error)}</div>` : ''}</td></tr>`;
  }).join('')}</tbody></table>`;
}
async function loadGroups(type) {
  const rows = await api('/api/groups?' + groupQuery(type));
  groupsData[type] = rows;
  const ids = new Set(rows.map((r) => r.advertiser_id));
  for (const id of [...selected[type]]) if (!ids.has(id)) selected[type].delete(id);
  const cols = 6;
  $(`#rows-${type}`).innerHTML = rows.map((a) => {
    const id = a.advertiser_id;
    const open = expanded.has(type + id);
    const checked = !!a.creatives_checked_at;
    return `<tr>
      <td><input type="checkbox" class="pick" data-group="${type}" value="${esc(id)}" ${selected[type].has(id) ? 'checked' : ''}></td>
      <td>${esc(a.name)}<div class="sub mono">${esc(id)}</div><div class="sub">${esc(a.company || '')}</div></td>
      <td>${statusBadge(a.status)}${a.rejection_reason ? `<div class="sub">${esc(a.rejection_reason)}</div>` : ''}${type === 'suspended' && a.suspended_at ? `<div class="sub">${a.suspended_at_estimated ? '≈ ' : ''}${fmtDate(a.suspended_at)}</div>` : ''}</td>
      <td>${summaryChips(a.summary, checked)}</td>
      <td>${progressSteps(a, type)}</td>
      <td><div class="row-actions">
        <button data-act="check" data-id="${esc(id)}" data-group="${type}">${checked ? 'Kiểm tra lại' : 'Kiểm tra creative'}</button>
        ${a.summary.total ? `<button data-act="appeal" data-id="${esc(id)}" data-group="${type}" class="primary">Appeal</button>` : ''}
        ${type === 'suspended' ? `<button data-act="accappeal" data-id="${esc(id)}">Appeal acc</button>` : ''}
        ${a.summary.total ? `<button data-act="toggle" data-id="${esc(id)}" data-group="${type}">${open ? '▾ Ẩn' : '▸ Xem'} creative</button>` : ''}
      </div></td>
    </tr>${open ? `<tr class="detail"><td colspan="${cols}">${creativeTable(a.creatives)}</td></tr>` : ''}`;
  }).join('') || `<tr><td colspan="${cols}" class="empty">${type === 'suspended' ? 'Không có account bị suspend trong khoảng ngày này. Bấm "Quét account" để cập nhật.' : 'Không có account đang chạy nào có creative vi phạm (hoặc chưa quét creative).'}</td></tr>`;
  updateActionBars();
}
function updateActionBars() {
  for (const type of ['suspended', 'active']) {
    const n = selected[type].size;
    const sel = groupsData[type].filter((a) => selected[type].has(a.advertiser_id));
    const toAppeal = sel.reduce((s, a) => s + a.summary.none + a.summary.failed, 0);
    $(`.selCount[data-group=${type}]`).textContent = `${n} account được chọn${n ? ` · ${toAppeal} creative chưa appeal` : ''}`;
    $(`.btnCheck[data-group=${type}]`).disabled = !n;
    $(`.btnBulk[data-group=${type}]`).disabled = !n;
    $(`.selAll[data-group=${type}]`).checked = n > 0 && n === groupsData[type].length;
  }
  $('#btnAccAppeal').disabled = !selected.suspended.size;
  const b = $('#btnAppealAds'); b.textContent = `Appeal đã chọn (${selected.ads.size})`; b.disabled = !selected.ads.size;
}

async function checkAccounts(ids, btn) {
  await withBusy(btn, async () => {
    const r = await api('/api/scan/creatives', { method: 'POST', body: { advertiser_ids: ids } });
    toast(`Đã kiểm tra ${r.accounts} account – ${r.rejected} creative vi phạm (${r.newRejected} mới)${r.errors.length ? `, ${r.errors.length} lỗi` : ''}`);
    await reload();
  });
}

// ===== Modal appeal creative (dùng chung cho 1 account, bulk nhiều account, hoặc chọn từng ad) =====
let amTarget = null;
function openAppealModal(target, title) {
  amTarget = target;
  $('#amTitle').textContent = title;
  $('#amTemplate').innerHTML = '<option value="auto">Tự chọn theo lý do vi phạm (khuyên dùng)</option>'
    + templates.filter((t) => t.kind === 'creative').map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')
    + '<option value="custom">Tuỳ chỉnh nội dung…</option>';
  $('#amText').value = ''; $('#amText').classList.add('hidden'); $('#amSkip').checked = true;
  $('#appealModal').showModal();
  previewAppeal();
}
function appealBody() {
  const tpl = $('#amTemplate').value;
  return { ...amTarget, template_id: tpl === 'custom' ? 'auto' : tpl, text: tpl === 'custom' ? $('#amText').value : undefined, skip_appealed: $('#amSkip').checked };
}
let previewSeq = 0;
async function previewAppeal() {
  const seq = ++previewSeq;
  const submit = $('#amSubmit');
  if ($('#amTemplate').value === 'custom' && !$('#amText').value.trim()) { $('#amRows').innerHTML = '<tr><td colspan="4" class="empty">Nhập nội dung appeal</td></tr>'; submit.disabled = true; return; }
  try {
    const plan = await api('/api/appeal/preview', { method: 'POST', body: appealBody() });
    if (seq !== previewSeq) return;
    $('#amSummary').textContent = `Sẽ gửi ${plan.items.length} appeal trên ${plan.accounts} account${plan.skipped.length ? ` · bỏ qua ${plan.skipped.length} creative đã appeal/đang xét` : ''}`;
    $('#amRows').innerHTML = plan.items.map((i) => `<tr><td>${esc(i.ad_name)}<div class="sub mono">${esc(i.ad_id)}</div></td><td>${esc(i.advertiser_name)}</td><td>${esc(i.template_name)}</td><td class="txt">${esc(i.reason)}</td></tr>`).join('')
      || '<tr><td colspan="4" class="empty">Không có creative nào cần appeal</td></tr>';
    submit.textContent = `Gửi ${plan.items.length} appeal`; submit.disabled = !plan.items.length;
  } catch (e) { $('#amSummary').textContent = 'Lỗi: ' + e.message; submit.disabled = true; }
}
$('#amTemplate').addEventListener('change', () => { $('#amText').classList.toggle('hidden', $('#amTemplate').value !== 'custom'); previewAppeal(); });
$('#amSkip').addEventListener('change', previewAppeal);
let amDebounce; $('#amText').addEventListener('input', () => { clearTimeout(amDebounce); amDebounce = setTimeout(previewAppeal, 300); });
$('#appealModal').addEventListener('close', async () => {
  if ($('#appealModal').returnValue !== 'ok') return;
  try {
    const job = await api('/api/appeal/bulk', { method: 'POST', body: appealBody() });
    renderJob(job); startJobPoll();
    toast(`Bắt đầu gửi ${job.total} appeal…`);
    selected.suspended.clear(); selected.active.clear(); selected.ads.clear(); updateActionBars();
  } catch (e) { toast('Lỗi: ' + e.message, 7000); }
});

// ===== Modal appeal account =====
let accModalIds = [];
function openAccountModal(ids) {
  accModalIds = ids;
  const list = groupsData.suspended.filter((a) => ids.includes(a.advertiser_id));
  $('#accList').innerHTML = list.map((a) => `<div class="acc-item">
      <div><b>${esc(a.name)}</b> <span class="sub mono">${esc(a.advertiser_id)}</span> ${statusBadge(a.status)} ${a.account_appealed_at ? `<span class="badge ok">Đã appeal ${fmtDate(a.account_appealed_at)}</span>` : ''}</div>
      <textarea rows="4" data-id="${esc(a.advertiser_id)}">${esc(a.account_appeal_text || '')}</textarea>
      <div class="row-actions" style="justify-content:flex-start">
        <button type="button" data-copy="${esc(a.advertiser_id)}">Copy</button>
        <a href="${adsManager(a.advertiser_id)}" target="_blank" rel="noopener"><button type="button">Mở Ads Manager ↗</button></a>
      </div></div>`).join('');
  $('#accModal').showModal();
}
$('#accList').addEventListener('click', (e) => {
  const id = e.target.dataset.copy; if (id) copy($(`textarea[data-id="${id}"]`, $('#accList')).value);
});
$('#accCopyAll').addEventListener('click', () => copy($$('#accList textarea').map((t) => `[${t.dataset.id}]\n${t.value}`).join('\n\n')));
$('#accMark').addEventListener('click', async () => {
  await api('/api/accounts/account-appealed', { method: 'POST', body: { advertiser_ids: accModalIds } });
  toast(`Đã đánh dấu ${accModalIds.length} account đã appeal`); $('#accModal').close(); loadGroups('suspended');
});

// ===== All creatives =====
const crQuery = () => new URLSearchParams({ from: $('#crFrom').value, to: $('#crTo').value, state: $('#crState').value, appeal: $('#crAppeal').value, q: $('#crQ').value });
async function loadCreatives() {
  const rows = await api('/api/creatives?' + crQuery());
  const ids = new Set(rows.map((r) => r.ad_id));
  for (const id of [...selected.ads]) if (!ids.has(id)) selected.ads.delete(id);
  $('#crRows').innerHTML = rows.map((c) => {
    const ok = (c.appeals || []).filter((a) => a.ok); const last = (c.appeals || []).at(-1);
    return `<tr>
      <td><input type="checkbox" class="crPick" value="${esc(c.ad_id)}" ${selected.ads.has(c.ad_id) ? 'checked' : ''} ${c.state !== 'rejected' ? 'disabled' : ''}></td>
      <td>${esc(c.ad_name)}<div class="sub mono">${esc(c.ad_id)}</div></td>
      <td>${esc(c.advertiser_name)}<div class="sub mono">${esc(c.advertiser_id)}</div></td>
      <td>${esc(c.campaign_name)}<div class="sub">${esc(c.adgroup_name)}</div></td>
      <td>${(c.reject_reasons || []).map((r) => `<div>${esc(r.reason)}</div>`).join('') || `<span class="badge">${esc(c.secondary_status)}</span>`}</td>
      <td>${fmtDate(c.detected_at)}${c.resolved_at ? `<div class="sub">Hết vi phạm ${fmtDate(c.resolved_at)}</div>` : ''}</td>
      <td>${c.appeal_status ? `<span class="badge">${esc(c.appeal_status)}</span>` : ''}${ok.length ? `<div class="sub">${ok.length} lần</div>` : ''}${last && !last.ok ? `<div class="sub" style="color:var(--danger)">${esc(last.error)}</div>` : ''}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="empty">Không có creative nào</td></tr>';
  $('#crAll').checked = false;
  updateActionBars();
}

// ===== Log =====
async function loadLog() {
  const rows = await api('/api/appeal-log');
  $('#logRows').innerHTML = rows.map((l) => `<tr><td>${fmtDate(l.at)}</td><td>${esc(l.ad_name)}<div class="sub mono">${esc(l.ad_id)}</div></td>
    <td>${esc(l.advertiser_name || '')}<div class="sub mono">${esc(l.advertiser_id)}</div></td><td>${esc(l.template_name || '')}</td><td>${l.auto ? 'Tự động' : 'Thủ công'}</td>
    <td>${l.ok ? '<span class="badge ok">Đã gửi</span>' : `<span class="badge danger">Lỗi</span> <span class="sub">${esc(l.error)}</span>`}</td></tr>`).join('')
    || '<tr><td colspan="6" class="empty">Chưa có appeal nào</td></tr>';
}

// ===== Templates =====
async function loadTemplates() { templates = await api('/api/templates'); }
function tplCard(t) {
  return `<form class="tpl" data-id="${esc(t.id || '')}">
    <label>Tên <input name="name" value="${esc(t.name)}" required></label>
    <label>Loại <select name="kind"><option value="creative" ${t.kind === 'creative' ? 'selected' : ''}>Appeal creative</option><option value="account" ${t.kind === 'account' ? 'selected' : ''}>Appeal account</option></select></label>
    <label>Từ khoá lý do vi phạm (cách nhau dấu phẩy, để trống = template chung) <input name="keywords" value="${esc((t.keywords || []).join(', '))}"></label>
    <label>Nội dung <textarea name="text" rows="6" required>${esc(t.text)}</textarea></label>
    <div class="row-actions" style="justify-content:flex-start"><button class="primary" type="submit">Lưu</button>${t.id ? '<button type="button" data-del>Xoá</button>' : ''}</div>
  </form>`;
}
async function renderTemplates() {
  await loadTemplates();
  $('#tplList').innerHTML = templates.map(tplCard).join('');
}
$('#btnNewTpl').addEventListener('click', () => { $('#tplList').insertAdjacentHTML('afterbegin', tplCard({ name: '', kind: 'creative', keywords: [], text: '' })); });
$('#tplList').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = e.target;
  try { await api('/api/templates', { method: 'POST', body: { id: f.dataset.id || undefined, name: f.name.value, kind: f.kind.value, keywords: f.keywords.value, text: f.text.value } }); toast('Đã lưu template'); renderTemplates(); }
  catch (err) { toast('Lỗi: ' + err.message); }
});
$('#tplList').addEventListener('click', async (e) => {
  if (!e.target.hasAttribute('data-del')) return;
  const f = e.target.closest('form'); if (!confirm('Xoá template này?')) return;
  try { await api('/api/templates/delete', { method: 'POST', body: { id: f.dataset.id } }); renderTemplates(); } catch (err) { toast('Lỗi: ' + err.message); }
});

// ===== Settings =====
async function loadSettings() {
  await loadTemplates();
  const s = await api('/api/settings'); const f = $('#settingsForm');
  f.defaultTemplateId.innerHTML = templates.filter((t) => t.kind === 'creative').map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  for (const [k, v] of Object.entries(s)) { const el = f.elements[k]; if (!el) continue; if (el.type === 'checkbox') el.checked = v; else el.value = v; }
}
$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = e.target;
  const body = { autoScan: f.autoScan.checked, autoAppeal: f.autoAppeal.checked, autoAppealScope: f.autoAppealScope.value, defaultTemplateId: f.defaultTemplateId.value,
    scanIntervalMinutes: +f.scanIntervalMinutes.value, maxAppealsPerRun: +f.maxAppealsPerRun.value, maxAppealsPerAd: +f.maxAppealsPerAd.value };
  if (body.autoAppeal && !confirm('Bật auto appeal: hệ thống sẽ tự gửi appeal (template tự chọn theo lý do) cho creative bị từ chối sau mỗi lần quét. Tiếp tục?')) return;
  try { await api('/api/settings', { method: 'POST', body }); toast('Đã lưu cài đặt'); refreshStatus(); } catch (err) { toast('Lỗi: ' + err.message); }
});

// ===== Navigation & events =====
const loaders = { suspended: () => loadGroups('suspended'), active: () => loadGroups('active'), creatives: loadCreatives, log: loadLog, templates: renderTemplates, settings: loadSettings };
const reload = () => Promise.all([refreshStatus(), loadTemplates(), loaders[$('.tabs .active').dataset.tab]()]).catch((e) => toast('Lỗi: ' + e.message));

$$('.tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  reload();
}));

$$('[data-sus-range]').forEach((b) => b.addEventListener('click', () => {
  const v = b.dataset.susRange;
  if (v === '') { $('#susFrom').value = ''; $('#susTo').value = ''; }
  else if (v === '1') { $('#susFrom').value = $('#susTo').value = dayStr(1); }
  else { $('#susFrom').value = dayStr(Number(v)); $('#susTo').value = dayStr(0); }
  loadGroups('suspended');
}));
['#susFrom', '#susTo'].forEach((s) => $(s).addEventListener('change', () => loadGroups('suspended')));
let debounce;
$('#susQ').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => loadGroups('suspended'), 250); });
$('#actQ').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => loadGroups('active'), 250); });
['#crFrom', '#crTo', '#crState', '#crAppeal'].forEach((s) => $(s).addEventListener('change', loadCreatives));
$('#crQ').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(loadCreatives, 250); });

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.classList.contains('pick')) { t.checked ? selected[t.dataset.group].add(t.value) : selected[t.dataset.group].delete(t.value); updateActionBars(); }
  if (t.classList.contains('selAll')) {
    const g = t.dataset.group; selected[g].clear();
    if (t.checked) groupsData[g].forEach((a) => selected[g].add(a.advertiser_id));
    $$(`.pick[data-group=${g}]`).forEach((cb) => { cb.checked = t.checked; }); updateActionBars();
  }
  if (t.classList.contains('crPick')) { t.checked ? selected.ads.add(t.value) : selected.ads.delete(t.value); updateActionBars(); }
  if (t.id === 'crAll') { $$('.crPick:not(:disabled)').forEach((cb) => { cb.checked = t.checked; t.checked ? selected.ads.add(cb.value) : selected.ads.delete(cb.value); }); updateActionBars(); }
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const { act, id, group } = b.dataset;
  const acc = group ? groupsData[group].find((a) => a.advertiser_id === id) : null;
  if (act === 'check') checkAccounts([id], b);
  if (act === 'appeal') openAppealModal({ advertiser_ids: [id] }, `Appeal creative – ${acc ? acc.name : id}`);
  if (act === 'accappeal') openAccountModal([id]);
  if (act === 'toggle') { const k = group + id; expanded.has(k) ? expanded.delete(k) : expanded.add(k); loadGroups(group); }
});
$$('.btnCheck').forEach((b) => b.addEventListener('click', () => checkAccounts([...selected[b.dataset.group]], b)));
$$('.btnCheckAll').forEach((b) => b.addEventListener('click', () => checkAccounts([], b)));
$$('.btnBulk').forEach((b) => b.addEventListener('click', () => {
  const ids = [...selected[b.dataset.group]];
  openAppealModal({ advertiser_ids: ids }, `Bulk appeal creative – ${ids.length} account`);
}));
$('#btnAccAppeal').addEventListener('click', () => openAccountModal([...selected.suspended]));
$('#btnAppealAds').addEventListener('click', () => openAppealModal({ ad_ids: [...selected.ads] }, `Appeal ${selected.ads.size} creative`));

$('#btnFullScan').addEventListener('click', (e) => withBusy(e.target, async () => {
  const r = await api('/api/scan/full', { method: 'POST' });
  toast(`Xong: ${r.accounts.suspended} account suspend, ${r.creatives.rejected} creative vi phạm${r.appeals ? `, đã auto appeal ${r.appeals.ok}` : ''}`);
  await reload();
}));
$('#btnScanAcc').addEventListener('click', (e) => withBusy(e.target, async () => {
  const r = await api('/api/scan/accounts', { method: 'POST' });
  toast(`Đã quét ${r.total} account – ${r.newlySuspended} account mới bị suspend`); await loadGroups('suspended');
}));
$('#btnExportAcc').addEventListener('click', () => { location.href = '/api/export/accounts.csv?' + new URLSearchParams({ view: 'suspended', from: $('#susFrom').value, to: $('#susTo').value, q: $('#susQ').value }); });
$('#btnExportCr').addEventListener('click', () => { location.href = '/api/export/creatives.csv?' + crQuery(); });

reload();
setInterval(refreshStatus, 15000);
