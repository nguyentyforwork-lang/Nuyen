import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.REPLICATE_API_TOKEN || '';
const DEMO = !TOKEN;

// Model dùng để tạo mặt AI từ prompt (model chính thức của Replicate)
const FACE_MODEL = process.env.FACE_MODEL || 'black-forest-labs/flux-schnell';
// Model ghép mặt vào video (model cộng đồng; có thể đổi trong .env)
const SWAP_MODEL = process.env.SWAP_MODEL || 'arabyai-replicate/roop_face_swap';
const SWAP_FACE_KEY = process.env.SWAP_FACE_KEY || 'swap_image';
const SWAP_VIDEO_KEY = process.env.SWAP_VIDEO_KEY || 'target_video';

// Thêm vào prompt để ảnh mặt dễ ghép: chính diện, 1 khuôn mặt, ánh sáng đều
const FACE_SUFFIX =
  'close-up portrait photo of a single person, face centered, looking straight at the camera, ' +
  'neutral even lighting, sharp focus, photorealistic, natural skin texture, plain background';

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 200 * 1024 * 1024 },
});

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------- Replicate helpers ----------
const API = 'https://api.replicate.com/v1';
const headers = (extra = {}) => ({ Authorization: `Bearer ${TOKEN}`, ...extra });

async function rjson(res) {
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { detail: text }; }
  if (!res.ok) throw new Error(data.detail || data.error || `Replicate lỗi ${res.status}`);
  return data;
}

// Tải file lên Replicate, trả về URL để dùng làm input
async function uploadFile(filePath, mime, name) {
  const form = new FormData();
  form.append('content', new Blob([fs.readFileSync(filePath)], { type: mime }), name);
  const data = await rjson(await fetch(`${API}/files`, { method: 'POST', headers: headers(), body: form }));
  return data.urls.get;
}

// Tạo prediction cho "owner/name" hoặc "owner/name:version"
const versionCache = new Map();
async function createPrediction(model, input, wait = false) {
  const extra = { 'Content-Type': 'application/json' };
  if (wait) extra.Prefer = 'wait=60';
  const [ref, pinned] = model.split(':');
  const post = (url, body) =>
    fetch(url, { method: 'POST', headers: headers(extra), body: JSON.stringify(body) }).then(rjson);

  if (pinned) return post(`${API}/predictions`, { version: pinned, input });

  // Model chính thức chạy trực tiếp; model cộng đồng thì lấy version mới nhất
  try {
    return await post(`${API}/models/${ref}/predictions`, { input });
  } catch (e) {
    let version = versionCache.get(ref);
    if (!version) {
      const info = await rjson(await fetch(`${API}/models/${ref}`, { headers: headers() }));
      version = info.latest_version?.id;
      if (!version) throw e;
      versionCache.set(ref, version);
    }
    return post(`${API}/predictions`, { version, input });
  }
}

const getPrediction = async (id) =>
  rjson(await fetch(`${API}/predictions/${id}`, { headers: headers() }));

const firstOutput = (o) => (Array.isArray(o) ? o[0] : o);

// ---------- API ----------
app.get('/api/config', (_req, res) => {
  res.json({ demo: DEMO, faceModel: FACE_MODEL, swapModel: SWAP_MODEL, faceSuffix: FACE_SUFFIX });
});

// 1) Tạo mặt AI từ prompt
app.post('/api/face', async (req, res) => {
  const prompt = String(req.body.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'Bạn chưa nhập prompt.' });
  const fullPrompt = `${prompt}, ${FACE_SUFFIX}`;
  try {
    if (DEMO) {
      const hue = [...prompt].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="hsl(${hue},40%,80%)"/><circle cx="256" cy="210" r="110" fill="hsl(${hue},30%,60%)"/><rect x="116" y="340" width="280" height="200" rx="120" fill="hsl(${hue},30%,60%)"/><text x="256" y="490" font-family="sans-serif" font-size="28" text-anchor="middle" fill="#333">DEMO</text></svg>`;
      return res.json({ url: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), fullPrompt, demo: true });
    }
    let p = await createPrediction(FACE_MODEL, {
      prompt: fullPrompt, aspect_ratio: '1:1', output_format: 'png', num_outputs: 1,
    }, true);
    while (['starting', 'processing'].includes(p.status)) {
      await new Promise((r) => setTimeout(r, 1500));
      p = await getPrediction(p.id);
    }
    if (p.status !== 'succeeded') throw new Error(p.error || 'Tạo mặt thất bại');
    res.json({ url: firstOutput(p.output), fullPrompt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2) Ghép mặt vào video
app.post('/api/swap',
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'face', maxCount: 1 }]),
  async (req, res) => {
    const video = req.files?.video?.[0];
    const faceFile = req.files?.face?.[0];
    const faceUrl = req.body.faceUrl;
    if (!video) return res.status(400).json({ error: 'Chưa có video.' });
    if (!faceFile && !faceUrl) return res.status(400).json({ error: 'Chưa có mặt AI.' });
    if (req.body.consent !== 'true') return res.status(400).json({ error: 'Cần xác nhận quyền sử dụng video.' });

    try {
      if (DEMO) {
        const ext = path.extname(video.originalname) || '.mp4';
        const name = video.filename + ext;
        fs.renameSync(video.path, path.join(UPLOAD_DIR, name));
        return res.json({ id: `demo:/uploads/${name}`, demo: true });
      }
      const videoUrl = await uploadFile(video.path, video.mimetype, video.originalname);
      const face = faceFile ? await uploadFile(faceFile.path, faceFile.mimetype, faceFile.originalname) : faceUrl;
      const p = await createPrediction(SWAP_MODEL, { [SWAP_FACE_KEY]: face, [SWAP_VIDEO_KEY]: videoUrl });
      res.json({ id: p.id });
    } catch (e) {
      res.status(500).json({ error: e.message });
    } finally {
      for (const f of [video, faceFile]) if (f && fs.existsSync(f.path)) fs.unlink(f.path, () => {});
    }
  });

// 3) Kiểm tra tiến độ
app.get('/api/swap/:id', async (req, res) => {
  const id = req.params.id;
  if (id.startsWith('demo:')) {
    return res.json({ status: 'succeeded', output: id.slice(5), logs: 'Chế độ DEMO: trả lại video gốc.' });
  }
  try {
    const p = await getPrediction(id);
    res.json({ status: p.status, output: firstOutput(p.output), error: p.error, logs: (p.logs || '').slice(-600) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Face Swap Studio: http://localhost:${PORT}${DEMO ? '  (DEMO — chưa có REPLICATE_API_TOKEN)' : ''}`);
});
