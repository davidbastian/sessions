// ─────────────────────────────────────────────────────────────────────────────
// Kling AI API client
// Docs: https://app.klingai.com/global/dev/document-api
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "crypto";

const KLING_BASE_URL = "https://api.klingai.com";

function buildJwt(accessKey: string, secretKey: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: accessKey,
      exp: Math.floor(Date.now() / 1000) + 1800,
      nbf: Math.floor(Date.now() / 1000) - 5,
    })
  ).toString("base64url");
  const sig = crypto
    .createHmac("sha256", secretKey)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function getHeaders() {
  const accessKey = process.env.KLING_ACCESS_KEY!;
  const secretKey = process.env.KLING_SECRET_KEY!;
  return {
    Authorization: `Bearer ${buildJwt(accessKey, secretKey)}`,
    "Content-Type": "application/json",
  };
}

async function klingPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${KLING_BASE_URL}${path}`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try { json = JSON.parse(text); } catch { throw new Error(`Kling non-JSON ${res.status}: ${text}`); }
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new Error(`Kling error ${json.code ?? res.status}: ${json.message ?? text}`);
  }
  return json;
}

async function klingGet(path: string) {
  const res = await fetch(`${KLING_BASE_URL}${path}`, { headers: getHeaders() });
  const text = await res.text();
  let json: Record<string, unknown>;
  try { json = JSON.parse(text); } catch { throw new Error(`Kling non-JSON ${res.status}: ${text}`); }
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new Error(`Kling error ${json.code ?? res.status}: ${json.message ?? text}`);
  }
  return json;
}

// ── Text-to-video (no start frame) ───────────────────────────────────────────

export interface KlingTextRequest {
  modelId: string;
  prompt: string;
  aspectRatio: string;
  duration: number;
}

export async function createKlingTextTask(req: KlingTextRequest) {
  // Note: text2video only supports v1-series models.
  // Omit model_name to use Kling's default (kling-v1-6).
  return klingPost("/v1/videos/text2video", {
    prompt: req.prompt,
    aspect_ratio: req.aspectRatio,
    duration: String(req.duration),
  });
}

export async function getKlingTextTaskStatus(taskId: string) {
  return klingGet(`/v1/videos/text2video/${taskId}`);
}

// ── Image-to-video (with start frame) ────────────────────────────────────────

export interface KlingVideoRequest {
  modelId: string;
  prompt: string;
  aspectRatio: string;
  duration: number;
  mode?: string;              // "std" | "pro" — pro required for end frame on v2-1
  startFrameBase64?: string;
  endFrameBase64?: string;
}

export async function createKlingVideoTask(req: KlingVideoRequest) {
  const body: Record<string, unknown> = {
    model_name: req.modelId,
    prompt: req.prompt,
    aspect_ratio: req.aspectRatio,
    duration: String(req.duration),
    image: req.startFrameBase64,
  };
  if (req.mode) body.mode = req.mode;
  if (req.endFrameBase64) body.image_tail = req.endFrameBase64;
  return klingPost("/v1/videos/image2video", body);
}

export async function getKlingTaskStatus(taskId: string) {
  return klingGet(`/v1/videos/image2video/${taskId}`);
}

// ── Kling O1 (Omni endpoint) ─────────────────────────────────────────────────

export interface KlingOmniRequest {
  prompt: string;
  aspectRatio: string;
  duration: number;
  startFrameBase64?: string;
  endFrameBase64?: string;
}

export async function createKlingOmniTask(req: KlingOmniRequest) {
  const body: Record<string, unknown> = {
    omni_version: "o1",
    prompt: req.prompt,
    aspect_ratio: req.aspectRatio,
    duration: String(req.duration),
  };
  if (req.startFrameBase64) body.frame_start = req.startFrameBase64;
  if (req.endFrameBase64) body.frame_end = req.endFrameBase64;
  return klingPost("/v1/videos/omni", body);
}

export async function getKlingOmniTaskStatus(taskId: string) {
  return klingGet(`/v1/videos/omni/${taskId}`);
}
