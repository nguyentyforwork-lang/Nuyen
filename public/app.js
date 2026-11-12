const $ = s => document.querySelector(s);
const STATUS = {
  queued: 'Đang chờ…',
  generating: 'Đang tạo video…',
  done: 'Xong',
  error: 'Lỗi',
};

let currentJob = null;
let pollTimer = null;
const cards = new Map(); // video id -> element

// ---------- Upload ----------
const fileInput = $('#file');
const drop = $('#drop');

function setFile(file) {
  if (!file || !file.type.startsWith('video/')) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  const pv = $('#preview');
  pv.src = URL.createObjectURL(file);
  pv.classList.remove('hidden');
  $('#dropEmpty').classList.add('hidden');
  $('#submit').disabled = false;
}

fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', ev => setFile(ev.dataTransfer.files[0]));

$('#form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const btn = $('#submit');
  btn.disabled = true;
  btn.textContent = 'Đang upload…';
  $('#formError').textContent = '';
  try {
    const res = await fetch('/api/jobs', { method: 'POST', body: new FormData(ev.target) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    location.hash = data.id;
  } catch (e) {
    $('#formError').textContent = e.message;
  } finally {
    btn.disabled = !fileInput.files.length;
    btn.textContent = 'Tạo 13 video';
  }
});

$('#newJob').addEventListener('click', () => { location.hash = ''; });

// ---------- Router ----------
window.addEventListener('hashchange', route);
async function route() {
  clearTimeout(pollTimer);
  const id = location.hash.slice(1);
  cards.clear();
  $('#variants').innerHTML = '';
  $('#structure').innerHTML = '';
  if (!id) {
    $('#jobView').classList.add('hidden');
    $('#uploadView').classList.remove('hidden');
    loadHistory();
    return;
  }
  $('#uploadView').classList.add('hidden');
  $('#jobView').classList.remove('hidden');
  $('#inputVideo').src = `/api/jobs/${id}/input`;
  $('#zipVariants').href = `/api/jobs/${id}/zip?group=variants`;
  $('#zipStructure').href = `/api/jobs/${id}/zip?group=structure`;
  poll(id);
}

async function poll(id) {
  try {
    const res = await fetch(`/api/jobs/${id}`);
    if (res.status === 404) { location.hash = ''; return; }
    const job = await res.json();
    if (location.hash.slice(1) !== id) return;
    render(job);
    const active = job.status === 'analyzing' || job.videos.some(v => v.status === 'queued' || v.status === 'generating');
    if (active) pollTimer = setTimeout(() => poll(id), 4000);
  } catch {
    pollTimer = setTimeout(() => poll(id), 6000);
  }
}

// ---------- Render ----------
function render(job) {
  currentJob = job;
  const landscape = job.options?.aspectRatio === '16:9';
  document.body.classList.toggle('landscape', landscape);

  const done = job.videos.filter(v => v.status === 'done').length;
  const failed = job.videos.filter(v => v.status === 'error').length;
  const total = job.videos.length || 13;

  let line;
  if (job.status === 'analyzing') line = '🔍 Đang phân tích concept video gốc…';
  else if (job.status === 'error') line = `❌ ${job.error}`;
  else if (done + failed < total) line = `🎬 Đang tạo video: ${done}/${total} xong${failed ? ` · ${failed} lỗi` : ''}`;
  else line = `✅ Hoàn tất: ${done}/${total} video${failed ? ` · ${failed} lỗi (bấm "Tạo lại")` : ''}`;
  $('#statusLine').textContent = line;
  $('#concept').textContent = job.analysis?.conceptSummary || '';
  $('#progressBar').style.width = job.status === 'analyzing' ? '4%' : `${Math.round((done / total) * 100)}%`;

  const doneIn = g => job.videos.some(v => v.group === g && v.status === 'done');
  $('#zipVariants').classList.toggle('disabled', !doneIn('variants'));
  $('#zipStructure').classList.toggle('disabled', !doneIn('structure'));

  if (job.status === 'analyzing') {
    if (!cards.size) placeholders();
    return;
  }
  if ([...cards.keys()].some(k => k.startsWith('ph'))) {
    cards.clear(); $('#variants').innerHTML = ''; $('#structure').innerHTML = '';
  }
  for (const v of job.videos) renderCard(job, v);
}

function placeholders() {
  for (let i = 0; i < 13; i++) {
    const el = $('#cardTpl').content.firstElementChild.cloneNode(true);
    el.querySelector('.vstate').innerHTML = '<div class="spinner"></div>Đang phân tích…';
    el.querySelector('.vtitle').textContent = i < 10 ? `#${i + 1}` : ['Hook', 'Hero', 'Promise'][i - 10];
    el.querySelector('details').remove();
    el.querySelector('.vactions').remove();
    (i < 10 ? $('#variants') : $('#structure')).appendChild(el);
    cards.set(`ph${i}`, el);
  }
}

function renderCard(job, v) {
  let el = cards.get(v.id);
  if (!el) {
    el = $('#cardTpl').content.firstElementChild.cloneNode(true);
    el.dataset.status = '';
    const title = el.querySelector('.vtitle');
    title.textContent = v.label;
    if (v.group === 'structure') {
      const b = document.createElement('span');
      b.className = `badge ${v.id}`; b.textContent = v.id;
      title.textContent = ''; title.append(v.label, b);
    }
    el.querySelector('.vsub').textContent = v.subtitle || '';
    el.querySelector('.vsub').title = v.subtitle || '';
    el.querySelector('.vprompt').value = v.prompt;
    el.querySelector('.retry').addEventListener('click', () => retry(job.id, v.id, el));
    const dl = el.querySelector('.dl');
    dl.href = `/api/jobs/${job.id}/videos/${v.id}?download=1`;
    (v.group === 'structure' ? $('#structure') : $('#variants')).appendChild(el);
    cards.set(v.id, el);
  }
  if (el.dataset.status === v.status) return;
  el.dataset.status = v.status;

  const box = el.querySelector('.vbox');
  box.innerHTML = '';
  if (v.status === 'done') {
    const video = document.createElement('video');
    video.src = `/api/jobs/${job.id}/videos/${v.id}?t=${Date.now()}#t=0.1`;
    video.controls = true; video.playsInline = true; video.preload = 'metadata'; video.loop = true;
    box.appendChild(video);
  } else {
    const st = document.createElement('div');
    st.className = 'vstate';
    st.innerHTML = (v.status === 'error' ? '⚠️<br>' : '<div class="spinner"></div>') + STATUS[v.status];
    box.appendChild(st);
  }
  el.querySelector('.verror').textContent = v.status === 'error' ? v.error || '' : '';
  el.querySelector('.dl').classList.toggle('disabled', v.status !== 'done');
  el.querySelector('.retry').disabled = v.status === 'queued' || v.status === 'generating';
}

async function retry(jobId, vid, el) {
  const prompt = el.querySelector('.vprompt').value;
  el.querySelector('.retry').disabled = true;
  const res = await fetch(`/api/jobs/${jobId}/videos/${vid}/retry`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }),
  });
  const job = await res.json();
  if (res.ok) { render(job); clearTimeout(pollTimer); pollTimer = setTimeout(() => poll(jobId), 3000); }
}

// ---------- Lịch sử ----------
async function loadHistory() {
  const list = await fetch('/api/jobs').then(r => r.json()).catch(() => []);
  const box = $('#history');
  box.innerHTML = list.length ? '<h2>Các lần tạo trước</h2>' : '';
  const label = { analyzing: 'đang phân tích', generating: 'đang tạo', done: 'xong', error: 'lỗi' };
  for (const j of list.slice(0, 20)) {
    const a = document.createElement('a');
    a.href = `#${j.id}`;
    const name = document.createElement('span'); name.textContent = j.name || j.id;
    const meta = document.createElement('span'); meta.className = 'muted';
    meta.textContent = `${new Date(j.createdAt).toLocaleString('vi-VN')} · ${label[j.status] || j.status}`;
    a.append(name, meta);
    box.appendChild(a);
  }
}

fetch('/api/config').then(r => r.json()).then(c => {
  $('#meta').textContent = c.mock ? 'MOCK mode — không gọi API' : `${c.analyzeModel} → ${c.veoModel}`;
});
route();
