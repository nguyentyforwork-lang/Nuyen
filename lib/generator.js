import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { fal } from "@fal-ai/client";

/**
 * Video generation backend (fal.ai). Every model id is overridable from .env,
 * so you can switch models without touching code.
 */
const MODELS = {
  image: process.env.FAL_IMAGE_MODEL || "fal-ai/flux/dev",
  swap: process.env.FAL_SWAP_MODEL || "fal-ai/wan/v2.2-14b/animate/replace",
  t2v: process.env.FAL_T2V_MODEL || "fal-ai/kling-video/v2.1/master/text-to-video",
};

export function createGenerator({ mock }) {
  if (mock) return mockGenerator();
  if (!process.env.FAL_KEY) {
    throw new Error("Thiếu FAL_KEY trong .env (hoặc chạy MOCK_MODE=1 để test giao diện).");
  }
  fal.config({ credentials: process.env.FAL_KEY });

  return {
    models: MODELS,

    async uploadSource(filePath) {
      const blob = new Blob([fs.readFileSync(filePath)], { type: "video/mp4" });
      return fal.storage.upload(blob);
    },

    async characterImage(prompt, meta) {
      const image_size = meta.aspect === "16:9" ? "landscape_16_9" : meta.aspect === "1:1" ? "square_hd" : "portrait_16_9";
      const { data } = await fal.subscribe(MODELS.image, {
        input: { prompt, image_size, num_images: 1 },
      });
      return pickUrl(data, "image");
    },

    async swapCharacter({ videoUrl, imageUrl }) {
      const { data } = await fal.subscribe(MODELS.swap, {
        input: { video_url: videoUrl, image_url: imageUrl },
      });
      return pickUrl(data, "video");
    },

    async textToVideo({ prompt, meta }) {
      const { data } = await fal.subscribe(MODELS.t2v, {
        input: { prompt, duration: "5", aspect_ratio: meta.aspect },
      });
      return pickUrl(data, "video");
    },
  };
}

function pickUrl(data, kind) {
  const url =
    data?.[kind]?.url ||
    data?.[`${kind}s`]?.[0]?.url ||
    data?.output?.[kind]?.url ||
    data?.url;
  if (!url) throw new Error(`Model không trả về ${kind}: ${JSON.stringify(data).slice(0, 300)}`);
  return url;
}

/** Offline stand-in: returns the source video after a delay so the UI can be tested without spending credits. */
function mockGenerator() {
  let source;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms + Math.random() * ms));
  return {
    models: { ...MODELS, note: "MOCK – không gọi API thật" },
    async uploadSource(filePath) {
      source = pathToFileURL(filePath).href;
      return source;
    },
    async characterImage() {
      await wait(400);
      return "mock://image";
    },
    async swapCharacter() {
      await wait(800);
      return source;
    },
    async textToVideo() {
      await wait(800);
      return source;
    },
  };
}
