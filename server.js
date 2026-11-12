// Nuyen Video Gen — upload 1 video, nhận 10 biến thể (chỉ đổi nhân vật) + 3 video Hero/Hook/Promise.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const express = require('express');
const multer = require('multer');
const { ZipArchive } = require('archiver');
const { GoogleGenAI, Type, createPartFromUri } = require('@google/genai');

const PORT = Number(process.env.PORT || 3000);
const MOCK = process.env.MOCK === '1';
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const ANALYZE_MODEL = process.env.ANALYZE_MODEL || 'gemini-2.5-flash';
const VEO_MODEL = process.env.VEO_MODEL || 'veo-3.1-fast-generate-preview';
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3));
const VARIANT_COUNT = 10;
const DATA_DIR = path.join(__dirname, 'data');

if (!MOCK && !API_KEY) {
  console.error('Thiếu GEMINI_API_KEY. Tạo file .env (xem .env.example) hoặc chạy với MOCK=1 để thử giao diện.');
  process.exit(1);
}
const ai = MOCK ? null : new GoogleGenAI({ apiKey: API_KEY });

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Lưu trạng thái job ----------
const jobs = new Map();

function jobDir(id) { return path.join(DATA_DIR, id); }

function saveJob(job) {
  fs.writeFileSync(path.join(jobDir(job.id), 'job.json'), JSON.stringify(job, null, 2));
}

function loadJobs() {
  for (const id of fs.readdirSync(DATA_DIR)) {
    const f = path.join(DATA_DIR, id, 'job.json');
    if (!fs.existsSync(f)) continue;
    try {
      const job = JSON.parse(fs.readFileSync(f, 'utf8'));
      // Job bị ngắt giữa chừng do server tắt: đánh dấu lỗi để người dùng bấm tạo lại.
      if (job.status === 'analyzing') { job.status = 'error'; job.error = 'Server khởi động lại khi đang phân tích.'; }
      for (const v of job.videos || []) {
        if (v.status === 'queued' || v.status === 'generating') { v.status = 'error'; v.error = 'Server khởi động lại — bấm "Tạo lại".'; }
      }
      jobs.set(id, job);
    } catch { /* bỏ qua job hỏng */ }
  }
}
loadJobs();

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    error: job.error,
    createdAt: job.createdAt,
    options: job.options,
    analysis: job.analysis && {
      conceptSummary: job.analysis.conceptSummary,
      originalCharacter: job.analysis.originalCharacter,
    },
    videos: (job.videos || []).map(v => ({
      id: v.id, group: v.group, label: v.label, subtitle: v.subtitle, prompt: v.prompt,
      status: v.status, error: v.error, ready: v.status === 'done',
    })),
  };
}

// ---------- Hàng đợi tạo video (giới hạn song song) ----------
let running = 0;
const queue = [];
function enqueue(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}
function pump() {
  while (running < CONCURRENCY && queue.length) {
    const { task, resolve, reject } = queue.shift();
    running++;
    task().then(resolve, reject).finally(() => { running--; pump(); });
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- Bước 1: phân tích video gốc ----------
const ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    conceptSummary: { type: Type.STRING, description: 'Tóm tắt concept video bằng tiếng Việt, 2-4 câu.' },
    originalCharacter: { type: Type.STRING, description: 'English. Detailed visual description of the main character in the source video (age, gender, ethnicity, hair, outfit, build).' },
    sceneTemplate: {
      type: Type.STRING,
      description: 'English Veo prompt that recreates the source video as one continuous clip (max 8s). Must contain the literal token [CHARACTER] wherever the main character is referenced and must NOT describe the main character\'s appearance anywhere else. Include setting, props/product, action beats in order, camera framing & movement, lighting, color grade, style, and audio (dialogue in the original language in quotes, SFX, music).',
    },
    characters: {
      type: Type.ARRAY,
      minItems: VARIANT_COUNT,
      maxItems: VARIANT_COUNT,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING, description: 'Tên ngắn tiếng Việt, ví dụ "Nữ văn phòng 25 tuổi".' },
          description: { type: Type.STRING, description: 'English, one sentence, specific visual description of this replacement character (age, gender, ethnicity, hair, outfit).' },
        },
        required: ['label', 'description'],
      },
    },
    hook: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING, description: 'Tiếng Việt, 1 câu: hook này làm gì.' },
        prompt: { type: Type.STRING, description: 'English Veo prompt.' },
      },
      required: ['summary', 'prompt'],
    },
    hero: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        prompt: { type: Type.STRING },
      },
      required: ['summary', 'prompt'],
    },
    promise: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        prompt: { type: Type.STRING },
      },
      required: ['summary', 'prompt'],
    },
  },
  required: ['conceptSummary', 'originalCharacter', 'sceneTemplate', 'characters', 'hook', 'hero', 'promise'],
};

function analysisInstruction(opts) {
  return `You are a senior performance-ad creative director. Watch the attached video carefully and break down its concept.

Produce:
1. conceptSummary (Vietnamese).
2. originalCharacter: the main on-screen person.
3. sceneTemplate: a single detailed Veo text-to-video prompt that faithfully recreates this video's concept (same setting, product, actions, camera, pacing, mood, audio). Use the token [CHARACTER] for the main person. Never describe the main person's looks outside the token so the character can be swapped while everything else stays identical.
4. characters: exactly ${VARIANT_COUNT} replacement characters that are clearly different from the original and from each other (vary age, gender, ethnicity, style), all plausible for this ad's target audience.${opts.characterHint ? ` User guidance for the characters: "${opts.characterHint}".` : ''}
5. Three separate standalone clips for the same concept, featuring the ORIGINAL character, same setting & style:
   - hook: the first 2-3 seconds that stop the scroll — a pattern interrupt, bold visual or question that raises the problem/curiosity.
   - hero: the hero shot — the product/offer showcased beautifully in use, the main visual moment of the ad.
   - promise: the payoff — the result/benefit/transformation the viewer will get, ending on a confident, satisfying moment (a clear call to action is fine).
   Each of these prompts must be a complete self-contained English Veo prompt (describe the character fully), max 8 seconds.

Output aspect ratio is ${opts.aspectRatio}. Do not include on-screen text or subtitles in prompts unless they are essential to the concept. Keep any spoken dialogue in the original video's language.`;
}

async function waitFileActive(file) {
  let f = file;
  for (let i = 0; i < 120 && f.state === 'PROCESSING'; i++) {
    await sleep(3000);
    f = await ai.files.get({ name: f.name });
  }
  if (f.state !== 'ACTIVE') throw new Error(`Gemini không xử lý được video (state=${f.state}).`);
  return f;
}

async function analyzeVideo(job) {
  if (MOCK) {
    await sleep(1500);
    return mockAnalysis();
  }
  const uploaded = await ai.files.upload({
    file: path.join(jobDir(job.id), job.inputFile),
    config: { mimeType: job.inputMime || 'video/mp4' },
  });
  const file = await waitFileActive(uploaded);
  const res = await ai.models.generateContent({
    model: ANALYZE_MODEL,
    contents: [{ role: 'user', parts: [createPartFromUri(file.uri, file.mimeType), { text: analysisInstruction(job.options) }] }],
    config: { responseMimeType: 'application/json', responseSchema: ANALYSIS_SCHEMA, temperature: 0.8 },
  });
  ai.files.delete({ name: file.name }).catch(() => {});
  const data = JSON.parse(res.text);
  if (!data.sceneTemplate.includes('[CHARACTER]')) {
    data.sceneTemplate = `[CHARACTER] is the main character. ${data.sceneTemplate}`;
  }
  data.characters = (data.characters || []).slice(0, VARIANT_COUNT);
  if (data.characters.length < VARIANT_COUNT) throw new Error('Gemini trả về thiếu nhân vật, hãy thử lại.');
  return data;
}

function buildVideos(analysis) {
  const variants = analysis.characters.map((c, i) => ({
    id: `v${String(i + 1).padStart(2, '0')}`,
    group: 'variants',
    label: `#${i + 1} · ${c.label}`,
    subtitle: c.description,
    prompt: analysis.sceneTemplate.split('[CHARACTER]').join(c.description.replace(/\.$/, '')),
    status: 'queued',
  }));
  const structure = ['hook', 'hero', 'promise'].map(k => ({
    id: k,
    group: 'structure',
    label: k[0].toUpperCase() + k.slice(1),
    subtitle: analysis[k].summary,
    prompt: analysis[k].prompt,
    status: 'queued',
  }));
  return [...variants, ...structure];
}

// ---------- Bước 2: tạo video bằng Veo ----------
async function generateOne(job, video) {
  const out = path.join(jobDir(job.id), `${video.id}.mp4`);
  if (MOCK) {
    await sleep(2000 + Math.random() * 4000);
    await mockVideo(job, video, out);
    return;
  }
  let op = await ai.models.generateVideos({
    model: VEO_MODEL,
    prompt: video.prompt,
    config: {
      numberOfVideos: 1,
      aspectRatio: job.options.aspectRatio,
      negativePrompt: 'subtitles, captions, watermark, text overlay, distorted hands, extra limbs',
    },
  });
  const started = Date.now();
  while (!op.done) {
    if (Date.now() - started > 15 * 60 * 1000) throw new Error('Quá thời gian chờ Veo (15 phút).');
    await sleep(10000);
    op = await ai.operations.getVideosOperation({ operation: op });
  }
  if (op.error) throw new Error(op.error.message || JSON.stringify(op.error));
  const gen = op.response?.generatedVideos?.[0];
  if (!gen?.video) {
    const reasons = op.response?.raiMediaFilteredReasons?.join('; ');
    throw new Error(reasons ? `Bị bộ lọc an toàn chặn: ${reasons}` : 'Veo không trả về video.');
  }
  if (gen.video.videoBytes) {
    await fsp.writeFile(out, Buffer.from(gen.video.videoBytes, 'base64'));
  } else {
    await ai.files.download({ file: gen.video, downloadPath: out });
  }
}

function runVideo(job, video) {
  video.status = 'queued';
  video.error = undefined;
  saveJob(job);
  return enqueue(async () => {
    video.status = 'generating';
    saveJob(job);
    try {
      await generateOne(job, video);
      video.status = 'done';
    } catch (e) {
      console.error(`[${job.id}/${video.id}]`, e);
      video.status = 'error';
      video.error = friendlyError(e);
    }
    saveJob(job);
  });
}

function friendlyError(e) {
  const msg = String(e?.message || e);
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) return 'Hết quota / rate limit của Veo. Đợi một lúc rồi bấm "Tạo lại".';
  if (/404|not found/i.test(msg) && /model/i.test(msg)) return `Không tìm thấy model ${VEO_MODEL}. Kiểm tra VEO_MODEL trong .env.`;
  return msg.length > 300 ? msg.slice(0, 300) + '…' : msg;
}

async function runJob(job) {
  try {
    job.status = 'analyzing';
    saveJob(job);
    job.analysis = await analyzeVideo(job);
    job.videos = buildVideos(job.analysis);
    job.status = 'generating';
    saveJob(job);
    await Promise.all(job.videos.map(v => runVideo(job, v)));
    job.status = 'done';
  } catch (e) {
    console.error(`[${job.id}]`, e);
    job.status = 'error';
    job.error = friendlyError(e);
  }
  saveJob(job);
}

// ---------- Mock (chạy thử không cần API) ----------
function mockAnalysis() {
  const people = ['Nữ văn phòng 25 tuổi', 'Nam sinh viên 20 tuổi', 'Mẹ bỉm sữa 32 tuổi', 'Ông chú 55 tuổi', 'Nữ gym 28 tuổi',
    'Nam doanh nhân 40 tuổi', 'Cô gái Gen Z', 'Bà ngoại 65 tuổi', 'Nam shipper 30 tuổi', 'Nữ y tá 35 tuổi'];
  const s = (summary) => ({ summary, prompt: `MOCK prompt — ${summary}` });
  return {
    conceptSummary: '(MOCK) Một người cầm sản phẩm, nói về vấn đề hằng ngày rồi cho thấy sản phẩm giải quyết vấn đề.',
    originalCharacter: 'A young woman in her twenties with long black hair, white t-shirt.',
    sceneTemplate: '[CHARACTER] stands in a bright kitchen holding the product to camera, vertical handheld UGC style.',
    characters: people.map(label => ({ label, description: `A person: ${label}` })),
    hook: s('Mở đầu bằng biểu cảm bất ngờ + câu hỏi về vấn đề.'),
    hero: s('Cận cảnh sản phẩm được dùng, ánh sáng đẹp.'),
    promise: s('Kết quả sau khi dùng, nhân vật hài lòng, kêu gọi mua.'),
  };
}

function mockVideo(job, video, out) {
  const [w, h] = job.options.aspectRatio === '16:9' ? [640, 360] : [360, 640];
  const hue = (parseInt(crypto.createHash('md5').update(video.id).digest('hex').slice(0, 2), 16) / 255) * 360;
  return new Promise(resolve => {
    execFile('ffmpeg', ['-y', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=24:duration=4`,
      '-vf', `hue=h=${hue.toFixed(0)}`, '-pix_fmt', 'yuv420p', out], err => {
      if (err) fs.copyFileSync(path.join(jobDir(job.id), job.inputFile), out);
      resolve();
    });
  });
}

// ---------- HTTP ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      req.jobId = crypto.randomBytes(6).toString('hex');
      fs.mkdirSync(jobDir(req.jobId), { recursive: true });
      cb(null, jobDir(req.jobId));
    },
    filename: (req, file, cb) => cb(null, 'input' + (path.extname(file.originalname).toLowerCase() || '.mp4')),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('video/')),
});

app.get('/api/config', (req, res) => res.json({ mock: MOCK, veoModel: VEO_MODEL, analyzeModel: ANALYZE_MODEL }));

app.post('/api/jobs', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Hãy chọn 1 file video.' });
  const job = {
    id: req.jobId,
    createdAt: new Date().toISOString(),
    status: 'analyzing',
    inputFile: req.file.filename,
    inputMime: req.file.mimetype,
    originalName: req.file.originalname,
    options: {
      aspectRatio: req.body.aspectRatio === '16:9' ? '16:9' : '9:16',
      characterHint: String(req.body.characterHint || '').slice(0, 500),
    },
    videos: [],
  };
  jobs.set(job.id, job);
  saveJob(job);
  runJob(job);
  res.json({ id: job.id });
});

function getJob(req, res) {
  const job = jobs.get(req.params.id);
  if (!job) res.status(404).json({ error: 'Không tìm thấy job.' });
  return job;
}

app.get('/api/jobs', (req, res) => {
  res.json([...jobs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(j => ({ id: j.id, createdAt: j.createdAt, status: j.status, name: j.originalName })));
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req, res);
  if (job) res.json(publicJob(job));
});

app.get('/api/jobs/:id/input', (req, res) => {
  const job = getJob(req, res);
  if (job) res.sendFile(path.join(jobDir(job.id), job.inputFile));
});

function fileName(job, v) {
  const slug = v.label.replace(/^#\d+ · /, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return v.group === 'structure' ? `${v.id}.mp4` : `${v.id}-${slug}.mp4`;
}

app.get('/api/jobs/:id/videos/:vid', (req, res) => {
  const job = getJob(req, res);
  if (!job) return;
  const v = job.videos.find(x => x.id === req.params.vid);
  if (!v || v.status !== 'done') return res.status(404).json({ error: 'Video chưa sẵn sàng.' });
  const file = path.join(jobDir(job.id), `${v.id}.mp4`);
  if (req.query.download) res.download(file, fileName(job, v));
  else res.sendFile(file);
});

app.post('/api/jobs/:id/videos/:vid/retry', (req, res) => {
  const job = getJob(req, res);
  if (!job) return;
  const v = job.videos.find(x => x.id === req.params.vid);
  if (!v) return res.status(404).json({ error: 'Không tìm thấy video.' });
  if (v.status === 'queued' || v.status === 'generating') return res.json(publicJob(job));
  if (typeof req.body?.prompt === 'string' && req.body.prompt.trim()) v.prompt = req.body.prompt.trim();
  job.status = 'generating';
  runVideo(job, v).then(() => {
    if (job.videos.every(x => x.status === 'done' || x.status === 'error')) { job.status = 'done'; saveJob(job); }
  });
  res.json(publicJob(job));
});

app.get('/api/jobs/:id/zip', (req, res) => {
  const job = getJob(req, res);
  if (!job) return;
  const group = req.query.group === 'structure' ? 'structure' : 'variants';
  const list = job.videos.filter(v => v.group === group && v.status === 'done');
  if (!list.length) return res.status(404).json({ error: 'Chưa có video nào xong.' });
  res.attachment(`${job.id}-${group === 'structure' ? 'hook-hero-promise' : '10-nhan-vat'}.zip`);
  const zip = new ZipArchive({ store: true });
  zip.on('error', err => res.destroy(err));
  zip.pipe(res);
  for (const v of list) zip.file(path.join(jobDir(job.id), `${v.id}.mp4`), { name: fileName(job, v) });
  zip.append(list.map(v => `${fileName(job, v)}\n${v.prompt}\n`).join('\n'), { name: 'prompts.txt' });
  zip.finalize();
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: String(err.message || err) });
});

app.listen(PORT, () => {
  console.log(`Nuyen Video Gen chạy tại http://localhost:${PORT}${MOCK ? '  (MOCK mode)' : ''}`);
  console.log(`  Phân tích: ${ANALYZE_MODEL} · Tạo video: ${VEO_MODEL} · Song song: ${CONCURRENCY}`);
});
