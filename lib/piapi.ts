// ─────────────────────────────────────────────────────────────────────────────
// PiAPI client — unified API for Kling and Seedance
// Docs: https://piapi.ai/docs/overview
// ─────────────────────────────────────────────────────────────────────────────

const PIAPI_BASE = "https://api.piapi.ai/api/v1";
const PIAPI_UPLOAD_BASE = "https://upload.theapi.app";

function getApiKey() {
  const apiKey = process.env.PIAPI_API_KEY;
  if (!apiKey) throw new Error("PIAPI_API_KEY not set");
  return apiKey;
}

async function piPost(path: string, body: Record<string, unknown>) {
  console.log("[PiAPI] ▶ POST", path, JSON.stringify(body, null, 2));
  const res = await fetch(`${PIAPI_BASE}${path}`, {
    method: "POST",
    headers: { "x-api-key": getApiKey(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try { json = JSON.parse(text); } catch { throw new Error(`PiAPI non-JSON ${res.status}: ${text}`); }
  if (!res.ok) {
    console.error("[PiAPI] ✕ full error response:", text);
    throw new Error(`PiAPI error ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function piGet(path: string) {
  const res = await fetch(`${PIAPI_BASE}${path}`, {
    headers: { "x-api-key": getApiKey(), "Content-Type": "application/json" },
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try { json = JSON.parse(text); } catch { throw new Error(`PiAPI non-JSON ${res.status}: ${text}`); }
  if (!res.ok) throw new Error(`PiAPI error ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// ── Image upload ──────────────────────────────────────────────────────────────
// Uploads a compressed base64 data URL to imgbb (free, no attribution required).
// Requires IMGBB_API_KEY in .env.local — get a free key at https://api.imgbb.com
// Images are auto-deleted after 10 minutes to avoid clutter.

async function uploadImage(dataUrl: string): Promise<string> {
  const imgbbKey = process.env.IMGBB_API_KEY;
  if (!imgbbKey) {
    throw new Error(
      "Image-to-video requires IMGBB_API_KEY in .env.local — " +
      "get a free key at https://api.imgbb.com then restart the server."
    );
  }

  const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
  if (!match) throw new Error("uploadImage: invalid data URL");
  const b64 = match[1];

  const body = new URLSearchParams({ key: imgbbKey, image: b64, expiration: "600" });
  const res = await fetch("https://api.imgbb.com/1/upload", {
    method: "POST",
    body,
  });

  const text = await res.text();
  let json: Record<string, unknown>;
  try { json = JSON.parse(text); } catch { throw new Error(`imgbb non-JSON ${res.status}: ${text}`); }
  if (!res.ok) throw new Error(`imgbb upload error ${res.status}: ${JSON.stringify(json)}`);

  const url = (json.data as Record<string, unknown>)?.url as string | undefined;
  if (!url) throw new Error(`imgbb: no url in response: ${JSON.stringify(json)}`);
  console.log("[PiAPI] Image uploaded via imgbb →", url.slice(0, 80));
  return url;
}

// Resolve: upload data URLs; pass through http/https URLs unchanged
async function resolveImageUrl(urlOrDataUrl: string): Promise<string> {
  if (urlOrDataUrl.startsWith("data:")) return uploadImage(urlOrDataUrl);
  return urlOrDataUrl;
}

// ── Shared request type ───────────────────────────────────────────────────────

export interface PiAPIVideoRequest {
  /** PiAPI model name: "kling" | "seedance" */
  model: string;
  /** task_type for the PiAPI request */
  taskType: string;
  /** Model version, e.g. "3.0", "o1" (Kling only) */
  version?: string;
  prompt: string;
  aspectRatio: string;
  duration: number;
  /** Resolution: "720p" | "1080p" — used by both Kling 3.0 and o1 */
  resolution?: string;
  /** Start frame / character image — data URL or HTTP URL */
  imageUrl?: string;
  /** End frame — Kling 3.0 and Seedance 2 */
  imageTailUrl?: string;
  /** Reference video URL — Seedance character replacement mode */
  videoUrl?: string;
  /** Enable Seedance character replacement (replaces person in videoUrl with imageUrl character) */
  characterReplace?: boolean;
}

// ── Kling (3.0 Omni + o1) ─────────────────────────────────────────────────────
// Both models use task_type: "omni_video_generation" and resolution (not mode).
// Images are passed as an array of HTTP URLs in input.images.

async function createKlingTask(req: PiAPIVideoRequest) {
  const input: Record<string, unknown> = {
    prompt: req.prompt,
    aspect_ratio: req.aspectRatio,
    duration: req.duration,
  };
  if (req.version)    input.version    = req.version;
  if (req.resolution) input.resolution = req.resolution;

  // Upload images to get HTTP URLs (PiAPI rejects data URLs in images[])
  if (req.imageUrl) {
    const url = await resolveImageUrl(req.imageUrl);
    input.images = [url];
    // Reference the image in the prompt so the model uses it as start frame
    if (!req.prompt.includes("@image_1")) input.prompt = `@image_1 ${req.prompt}`;
  }
  if (req.imageTailUrl) {
    // Kling 3.0 Omni supports end frame via a second image with @image_2 reference
    const url = await resolveImageUrl(req.imageTailUrl);
    const existing = (input.images as string[] | undefined) ?? [];
    input.images = [...existing, url];
    const promptStr = input.prompt as string;
    if (!promptStr.includes("@image_2")) input.prompt = `${promptStr} @image_2`;
  }

  const body = {
    model: "kling",
    task_type: req.taskType,
    input,
    config: { service_mode: "public" },
  };
  return piPost("/task", body);
}

// ── Seedance ──────────────────────────────────────────────────────────────────

async function createSeedanceTask(req: PiAPIVideoRequest) {
  let prompt = req.prompt;
  const imageUrls: string[] = [];

  // ── Character replacement mode ────────────────────────────────────────────
  // Requires: reference video (video_urls) + character image (image_urls)
  // Prompt: "Replace the person in the video with the character in @image1"
  if (req.characterReplace && req.videoUrl) {
    if (req.imageUrl) {
      const charUrl = await resolveImageUrl(req.imageUrl);
      imageUrls.push(charUrl);
    }
    // Auto-inject @image1 reference if not present
    if (imageUrls.length > 0 && !prompt.includes("@image1")) {
      prompt = `Replace the person in the video with the character in @image1. ${prompt}`.trim();
    }
    const input: Record<string, unknown> = {
      prompt,
      aspect_ratio: req.aspectRatio,
      video_urls: [req.videoUrl],
    };
    if (imageUrls.length > 0) input.image_urls = imageUrls;
    console.log("[Seedance] character replace mode, video:", req.videoUrl.slice(0, 80));
    return piPost("/task", {
      model: "seedance",
      task_type: req.taskType,
      input,
      config: { service_mode: "public" },
    });
  }

  // ── Normal generation (text-to-video / image-to-video / morphing) ─────────
  if (req.imageUrl) {
    const url = await resolveImageUrl(req.imageUrl);
    imageUrls.push(url);
    if (!prompt.includes("@image1")) prompt = `@image1 ${prompt}`;
  }

  // End frame: second image → "@image1 transitions into @image2"
  if (req.imageTailUrl) {
    const url = await resolveImageUrl(req.imageTailUrl);
    imageUrls.push(url);
    if (!prompt.includes("@image2")) prompt = `${prompt} transitions into @image2`;
  }

  const input: Record<string, unknown> = {
    prompt,
    aspect_ratio: req.aspectRatio,
    duration: req.duration,
  };
  if (imageUrls.length > 0) input.image_urls = imageUrls;

  return piPost("/task", {
    model: "seedance",
    task_type: req.taskType,
    input,
    config: { service_mode: "public" },
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function createPiAPIVideoTask(req: PiAPIVideoRequest) {
  if (req.model === "seedance") return createSeedanceTask(req);
  return createKlingTask(req);
}

export async function getPiAPITaskStatus(taskId: string) {
  return piGet(`/task/${taskId}`);
}
