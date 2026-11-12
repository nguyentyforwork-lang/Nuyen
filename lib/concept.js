import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const EXTRA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "prompt"],
  properties: {
    title: { type: "string", description: "Tiêu đề ngắn tiếng Việt." },
    description: { type: "string", description: "Giải thích ngắn tiếng Việt video này làm gì." },
    prompt: { type: "string", description: "English text-to-video prompt, 5 seconds, same concept/style as the original." },
  },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["concept_summary", "original_character", "setting", "visual_style", "variants", "hook", "hero", "promise"],
  properties: {
    concept_summary: { type: "string", description: "Tóm tắt concept/kịch bản của video gốc (tiếng Việt)." },
    original_character: { type: "string", description: "Mô tả nhân vật chính trong video gốc." },
    setting: { type: "string", description: "Bối cảnh, ánh sáng, góc máy." },
    visual_style: { type: "string", description: "Phong cách hình ảnh, nhịp dựng, tông màu." },
    variants: {
      type: "array",
      description: "Đúng 10 nhân vật thay thế, đa dạng.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "character_description", "image_prompt"],
        properties: {
          name: { type: "string", description: "Tên ngắn cho biến thể, tiếng Việt, ví dụ 'Mẹ bỉm 30 tuổi'." },
          character_description: { type: "string", description: "Mô tả nhân vật mới bằng tiếng Anh (1-2 câu)." },
          image_prompt: { type: "string", description: "English prompt for a photorealistic full-body reference image of the new character, same outfit category/pose/framing as the original, plain neutral background." },
        },
      },
    },
    hook: EXTRA,
    hero: EXTRA,
    promise: EXTRA,
  },
};

const SYSTEM = `You are a performance-ad creative strategist for TikTok.
You receive frames from a short ad video. Work out its concept (what happens, who is on screen, product, setting, style, pacing).

Then produce:
1. Exactly 10 character variants. The concept, action, setting, product, framing and style stay the same; ONLY the on-screen character changes. Make them diverse (age, gender, ethnicity, body type, style) while staying plausible for the product's target audience. Each needs an image prompt for a photorealistic reference image of that person.
2. Three standalone video prompts for the same concept:
   - hook: the first 1-3 seconds scroll-stopper - a surprising, pattern-interrupting moment that makes viewers stop scrolling.
   - hero: the hero shot - the product/main subject showcased beautifully, the money shot of the concept.
   - promise: the outcome/benefit the viewer is promised - the after-state or transformation the product delivers.
Write prompts in English and cinematic detail (subject, action, camera, lighting). Do not include on-screen text, logos of real brands, or real people's likeness.
Vietnamese for summary/title/name/description fields.`;

export async function analyzeConcept({ frames, meta, notes, mock }) {
  if (mock && !process.env.ANTHROPIC_API_KEY) return mockConcept();

  const client = new Anthropic();
  const content = [
    ...frames.flatMap((f, i) => [
      { type: "text", text: `Frame ${i + 1} @ ${f.t.toFixed(1)}s` },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.data } },
    ]),
    {
      type: "text",
      text: `Video: ${meta.duration.toFixed(1)}s, ${meta.width}x${meta.height} (${meta.aspect}).` +
        (notes ? `\nGhi chú của người dùng về concept: ${notes}` : "") +
        `\nPhân tích concept và trả về JSON theo schema.`,
    },
  ];

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });
  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    throw new Error(`Claude từ chối phân tích video: ${response.stop_details?.explanation || "không rõ lý do"}`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("Phân tích bị cắt do vượt max_tokens.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const concept = JSON.parse(text);
  if (!Array.isArray(concept.variants) || concept.variants.length < 10) {
    throw new Error(`Claude chỉ trả về ${concept.variants?.length || 0}/10 nhân vật.`);
  }
  concept.variants = concept.variants.slice(0, 10);
  return concept;
}

function mockConcept() {
  const people = ["Cô gái Gen Z", "Mẹ bỉm 30 tuổi", "Anh dân văn phòng", "Ông bà U60", "Gymer cơ bắp", "Sinh viên nam", "Nữ doanh nhân", "Cô gái da màu", "Chàng trai Hàn", "Bác nông dân"];
  return {
    concept_summary: "[MOCK] Một người cầm sản phẩm, giới thiệu công dụng và phản ứng bất ngờ trước kết quả.",
    original_character: "[MOCK] Cô gái 25 tuổi, áo thun trắng.",
    setting: "[MOCK] Phòng khách sáng, góc máy selfie.",
    visual_style: "[MOCK] UGC, cắt nhanh, tông ấm.",
    variants: people.map((name) => ({
      name,
      character_description: `A ${name} presenting the product.`,
      image_prompt: `Photorealistic full-body photo of a ${name}, plain background.`,
    })),
    hook: { title: "Hook", description: "[MOCK] 3 giây đầu gây tò mò.", prompt: "Close-up surprised face reveals product." },
    hero: { title: "Hero", description: "[MOCK] Cảnh hero sản phẩm.", prompt: "Slow orbit around product on pedestal, soft light." },
    promise: { title: "Promise", description: "[MOCK] Kết quả mà sản phẩm hứa hẹn.", prompt: "Happy person enjoying the after-state result." },
  };
}
