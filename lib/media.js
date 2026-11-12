import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";

const run = promisify(execFile);

/** Duration, size and the nearest supported aspect ratio of the input video. */
export async function probeVideo(file) {
  const { stdout } = await run(ffprobe.path, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height:format=duration",
    "-of", "json",
    file,
  ]);
  const info = JSON.parse(stdout);
  const { width, height } = info.streams?.[0] || {};
  const duration = Number(info.format?.duration || 0);
  const ratio = width && height ? width / height : 9 / 16;
  const aspect = ratio < 0.8 ? "9:16" : ratio > 1.25 ? "16:9" : "1:1";
  return { width, height, duration, aspect };
}

/** Extracts up to 6 evenly spaced JPEG frames (max 768px) for concept analysis. */
export async function extractFrames(file, outDir, duration) {
  const count = 6;
  const frameDir = path.join(outDir, "frames");
  fs.mkdirSync(frameDir, { recursive: true });
  const frames = [];
  for (let i = 0; i < count; i++) {
    const t = duration > 0 ? (duration * (i + 0.5)) / count : i;
    const out = path.join(frameDir, `f${i}.jpg`);
    try {
      await run(ffmpegPath, [
        "-y", "-ss", t.toFixed(2), "-i", file,
        "-frames:v", "1",
        "-vf", "scale='if(gt(iw,ih),768,-2)':'if(gt(iw,ih),-2,768)'",
        "-q:v", "4", out,
      ]);
      if (fs.existsSync(out)) frames.push({ t, data: fs.readFileSync(out).toString("base64") });
    } catch {
      // Seeking past the end on very short clips: skip that frame.
    }
  }
  if (!frames.length) throw new Error("Không đọc được khung hình nào từ video.");
  return frames;
}
