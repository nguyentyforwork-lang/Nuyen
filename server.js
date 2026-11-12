import "dotenv/config";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { analyzeConcept } from "./lib/concept.js";
import { extractFrames, probeVideo } from "./lib/media.js";
import { createGenerator } from "./lib/generator.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(here, "uploads");
const OUTPUT_DIR = path.join(here, "outputs");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const MOCK = process.env.MOCK_MODE === "1";
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const generator = createGenerator({ mock: MOCK });

const app = express();
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("video/")),
});

/** In-memory job store. */
const jobs = new Map();

function publicJob(job) {
  const { inputPath, ...rest } = job;
  return rest;
}

app.use(express.static(path.join(here, "public")));
app.use("/outputs", express.static(OUTPUT_DIR));

app.get("/api/config", (_req, res) => {
  res.json({ mock: MOCK, models: generator.models });
});

app.post("/api/jobs", upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Cần upload 1 file video." });
  const id = randomUUID().slice(0, 8);
  const ext = path.extname(req.file.originalname) || ".mp4";
  const inputPath = `${req.file.path}${ext}`;
  fs.renameSync(req.file.path, inputPath);

  const job = {
    id,
    status: "queued",
    stage: "Đang chờ",
    originalName: req.file.originalname,
    notes: (req.body.notes || "").slice(0, 2000),
    createdAt: Date.now(),
    inputPath,
    concept: null,
    variants: Array.from({ length: 10 }, (_, i) => ({ key: `v${i + 1}`, index: i + 1, status: "pending" })),
    extras: ["hook", "hero", "promise"].map((k) => ({ key: k, status: "pending" })),
    error: null,
  };
  jobs.set(id, job);
  runJob(job).catch((err) => {
    console.error(`[job ${id}]`, err);
    job.status = "failed";
    job.error = err.message || String(err);
  });
  res.json({ id });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Không tìm thấy job" });
  res.json(publicJob(job));
});

app.post("/api/jobs/:id/retry/:key", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.concept) return res.status(404).json({ error: "Không tìm thấy job" });
  const item = [...job.variants, ...job.extras].find((x) => x.key === req.params.key);
  if (!item) return res.status(404).json({ error: "Không tìm thấy video" });
  if (item.status === "running") return res.json({ ok: true });
  const task = item.key.startsWith("v") ? () => makeVariant(job, item) : () => makeExtra(job, item);
  task();
  res.json({ ok: true });
});

app.get("/api/download/:id/:key", (req, res) => {
  const job = jobs.get(req.params.id);
  const item = job && [...job.variants, ...job.extras].find((x) => x.key === req.params.key);
  if (!item || item.status !== "done") return res.status(404).send("Video chưa sẵn sàng");
  res.download(path.join(OUTPUT_DIR, job.id, item.file), item.downloadName);
});

async function runJob(job) {
  job.status = "running";
  const outDir = path.join(OUTPUT_DIR, job.id);
  fs.mkdirSync(outDir, { recursive: true });

  job.stage = "Đọc video";
  job.meta = await probeVideo(job.inputPath);
  const frames = await extractFrames(job.inputPath, outDir, job.meta.duration);

  job.stage = "Phân tích concept";
  job.concept = await analyzeConcept({ frames, meta: job.meta, notes: job.notes, mock: MOCK });
  job.variants.forEach((v, i) => Object.assign(v, job.concept.variants[i]));
  job.extras.forEach((x) => Object.assign(x, job.concept[x.key]));

  job.stage = "Upload video gốc";
  job.sourceUrl = await generator.uploadSource(job.inputPath);

  job.stage = "Đang gen video";
  const tasks = [
    ...job.variants.map((v) => () => makeVariant(job, v)),
    ...job.extras.map((x) => () => makeExtra(job, x)),
  ];
  await runPool(tasks, CONCURRENCY);

  const failed = [...job.variants, ...job.extras].filter((x) => x.status === "failed").length;
  job.status = "done";
  job.stage = failed ? `Xong (${failed} video lỗi – bấm Thử lại)` : "Hoàn tất";
}

async function makeVariant(job, v) {
  v.status = "running";
  v.error = null;
  try {
    v.step = "Tạo ảnh nhân vật";
    v.characterImageUrl = await generator.characterImage(v.image_prompt, job.meta);
    v.step = "Thay nhân vật vào video";
    const url = await generator.swapCharacter({ videoUrl: job.sourceUrl, imageUrl: v.characterImageUrl, prompt: v.character_description });
    await saveResult(job, v, url, `variant-${String(v.index).padStart(2, "0")}-${slug(v.name)}.mp4`);
  } catch (err) {
    fail(v, err);
  }
}

async function makeExtra(job, x) {
  x.status = "running";
  x.error = null;
  try {
    x.step = "Gen video";
    const url = await generator.textToVideo({ prompt: x.prompt, meta: job.meta });
    await saveResult(job, x, url, `${x.key}-${slug(x.title || x.key)}.mp4`);
  } catch (err) {
    fail(x, err);
  }
}

async function saveResult(job, item, url, filename) {
  item.step = "Lưu file";
  const dest = path.join(OUTPUT_DIR, job.id, filename);
  if (url.startsWith("file://")) {
    fs.copyFileSync(fileURLToPath(url), dest);
  } else {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Tải kết quả lỗi: HTTP ${r.status}`);
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  }
  item.file = filename;
  item.downloadName = filename;
  item.previewUrl = `/outputs/${job.id}/${encodeURIComponent(filename)}`;
  item.downloadUrl = `/api/download/${job.id}/${item.key}`;
  item.status = "done";
  item.step = null;
}

function fail(item, err) {
  console.error(`[${item.key}]`, err);
  item.status = "failed";
  item.step = null;
  item.error = err?.body?.detail ? JSON.stringify(err.body.detail) : err.message || String(err);
}

async function runPool(tasks, n) {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await queue.shift()();
  });
  await Promise.all(workers);
}

function slug(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "video";
}

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Video generator chạy tại http://localhost:${PORT}${MOCK ? " (MOCK MODE)" : ""}`);
});
