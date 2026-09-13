// ─────────────────────────────────────────────────────────────────────────────
// MODELS CONFIG
// To add a new model (e.g. Seedance 2), just add a new entry below.
// No other code changes needed.
// ─────────────────────────────────────────────────────────────────────────────

export type ModelType = "image" | "video";

export interface AspectRatio {
  label: string;
  value: string;
  width: number;
  height: number;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  type: ModelType;
  description: string;
  aspectRatios: AspectRatio[];
  supportsImageRef: boolean;
  supportsStartEndFrame: boolean;    // supports start frame
  supportsEndFrame: boolean;         // supports end frame; requires start frame too
  proModeForEndFrame?: boolean;      // must send mode:"pro" when end frame is used
  supportsCharacterReplace?: boolean; // Seedance: replace character in a reference video
  apiModel?: string;
  usesOmniEndpoint?: boolean;
  apiProvider?: "piapi" | "piapi-image" | "fal-image"; // piapi = video via PiAPI tasks; piapi-image = image via PiAPI OpenAI-compat; fal-image = image via fal.ai
  piAPIVersion?: string;          // version string for PiAPI (e.g. "3.0", "o1")
  piAPITaskType?: string;         // task_type for PiAPI request
  resolutions?: string[];         // e.g. ["720p", "1080p"]
  durations?: number[];           // allowed durations (overrides default [5,10])
  enabled: boolean;
}

export const ASPECT_RATIOS: AspectRatio[] = [
  { label: "16:9", value: "16:9", width: 1920, height: 1080 },
  { label: "9:16", value: "9:16", width: 1080, height: 1920 },
  { label: "1:1", value: "1:1", width: 1024, height: 1024 },
  { label: "4:3", value: "4:3", width: 1024, height: 768 },
  { label: "3:4", value: "3:4", width: 768, height: 1024 },
  { label: "21:9", value: "21:9", width: 2048, height: 878 },
];

export const MODELS: ModelConfig[] = [
  // ── IMAGE GENERATION ────────────────────────────────────────────────────────
  {
    id: "nano-banana-pro",
    name: "Nano Banana Pro",
    provider: "Google",
    type: "image",
    description: "Gemini 3 Pro Image — highest quality, detailed prompts",
    aspectRatios: ASPECT_RATIOS,
    supportsImageRef: true,
    supportsStartEndFrame: false,
    supportsEndFrame: false,
    apiModel: "gemini-3-pro-image-preview",
    enabled: true,
  },
  {
    id: "nano-banana-2",
    name: "Nano Banana 2",
    provider: "Google",
    type: "image",
    description: "Gemini 3.1 Flash Image — faster generation",
    aspectRatios: ASPECT_RATIOS,
    supportsImageRef: true,
    supportsStartEndFrame: false,
    supportsEndFrame: false,
    apiModel: "gemini-3.1-flash-image-preview",
    enabled: true,
  },

  {
    id: "gpt-image-2",
    name: "GPT Image 2",
    provider: "OpenAI / PiAPI",
    type: "image",
    description: "GPT-Image-2 via PiAPI — OpenAI's newest image model, $0.10/gen",
    aspectRatios: [
      { label: "1:1",  value: "1:1",  width: 1024, height: 1024 },
      { label: "16:9", value: "16:9", width: 1536, height: 1024 },
      { label: "9:16", value: "9:16", width: 1024, height: 1536 },
    ],
    supportsImageRef: true,
    supportsStartEndFrame: false,
    supportsEndFrame: false,
    apiModel: "gpt-image-2-preview",
    apiProvider: "piapi-image",
    enabled: true,
  },

  {
    id: "flux-kontext",
    name: "FLUX Kontext",
    provider: "Black Forest Labs / fal.ai",
    type: "image",
    description: "FLUX.1 Kontext Max — purpose-built for style transfer & multi-image editing",
    aspectRatios: [
      { label: "16:9", value: "16:9", width: 1920, height: 1080 },
      { label: "9:16", value: "9:16", width: 1080, height: 1920 },
      { label: "1:1",  value: "1:1",  width: 1024, height: 1024 },
      { label: "4:3",  value: "4:3",  width: 1024, height: 768 },
      { label: "3:4",  value: "3:4",  width: 768,  height: 1024 },
      { label: "21:9", value: "21:9", width: 2048, height: 878 },
    ],
    supportsImageRef: true,
    supportsStartEndFrame: false,
    supportsEndFrame: false,
    apiModel: "fal-ai/flux-pro/kontext/max/multi",
    apiProvider: "fal-image",
    enabled: true,
  },

  // ── VIDEO / ANIMATION ───────────────────────────────────────────────────────
  {
    id: "kling-3.0",
    name: "Kling 3.0 Omni",
    provider: "Kling AI / PiAPI",
    type: "video",
    description: "Start + end frame, 720p/1080p, 3–15s — $0.10–0.15/sec",
    aspectRatios: [
      { label: "16:9", value: "16:9", width: 1920, height: 1080 },
      { label: "9:16", value: "9:16", width: 1080, height: 1920 },
      { label: "1:1", value: "1:1", width: 1024, height: 1024 },
    ],
    supportsImageRef: true,
    supportsStartEndFrame: true,
    supportsEndFrame: true,
    apiModel: "kling",
    apiProvider: "piapi",
    piAPIVersion: "3.0",
    piAPITaskType: "omni_video_generation",
    resolutions: ["720p", "1080p"],
    durations: [3, 5, 10, 15],
    enabled: true,
  },
  {
    id: "kling-o1",
    name: "Kling o1",
    provider: "Kling AI / PiAPI",
    type: "video",
    description: "Reasoning model, 720p/1080p, 5s/10s — $0.39–1.04",
    aspectRatios: [
      { label: "16:9", value: "16:9", width: 1920, height: 1080 },
      { label: "9:16", value: "9:16", width: 1080, height: 1920 },
      { label: "1:1", value: "1:1", width: 1024, height: 1024 },
    ],
    supportsImageRef: true,
    supportsStartEndFrame: true,
    supportsEndFrame: false,
    apiModel: "kling",
    apiProvider: "piapi",
    piAPIVersion: "o1",
    piAPITaskType: "omni_video_generation",
    resolutions: ["720p", "1080p"],
    durations: [5, 10],
    enabled: true,
  },
  {
    id: "seedance-2",
    name: "Seedance 2",
    provider: "ByteDance / PiAPI",
    type: "video",
    description: "Start frame, 16:9/9:16/4:3, 5–15s — $0.15/sec",
    aspectRatios: [
      { label: "16:9", value: "16:9", width: 1920, height: 1080 },
      { label: "9:16", value: "9:16", width: 1080, height: 1920 },
      { label: "4:3", value: "4:3", width: 1024, height: 768 },
      { label: "3:4", value: "3:4", width: 768, height: 1024 },
    ],
    supportsImageRef: true,
    supportsStartEndFrame: true,
    supportsEndFrame: true,
    supportsCharacterReplace: true,
    apiModel: "seedance",
    apiProvider: "piapi",
    piAPITaskType: "seedance-2-preview",
    durations: [5, 10, 15],
    enabled: true,
  },

  // ── ADD NEW MODELS HERE ─────────────────────────────────────────────────────
  // Example: Seedance 2
  // {
  //   id: "seedance-2",
  //   name: "Seedance 2",
  //   provider: "ByteDance",
  //   type: "video",
  //   description: "Seedance 2 video generation",
  //   aspectRatios: ASPECT_RATIOS,
  //   supportsImageRef: true,
  //   supportsStartEndFrame: true,
  //   apiModel: "seedance-v2",
  //   enabled: false, // set to true when you add the API
  // },
];

export const getImageModels = () =>
  MODELS.filter((m) => m.type === "image" && m.enabled);

export const getVideoModels = () =>
  MODELS.filter((m) => m.type === "video" && m.enabled);

export const getModelById = (id: string) => MODELS.find((m) => m.id === id);
