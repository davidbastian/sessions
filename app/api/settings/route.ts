import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const ENV_PATH = path.join(process.cwd(), ".env.local");

// ── Helpers ────────────────────────────────────────────────────────────────────

function readEnv(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) return {};
  const result: Record<string, string> = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

function writeEnv(env: Record<string, string>) {
  const content = Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  fs.writeFileSync(ENV_PATH, content, "utf-8");
}

function mask(val: string): string {
  if (!val) return "";
  if (val.length <= 8) return "••••••••";
  return val.slice(0, 4) + "••••••••••••" + val.slice(-4);
}

// ── Key definitions ────────────────────────────────────────────────────────────

const KEY_DEFS = [
  {
    id: "GOOGLE_AI_API_KEY",
    label: "Google AI API Key",
    provider: "Google",
    hint: "Used for Nano Banana image generation & prompt improvement",
    docsUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "PIAPI_API_KEY",
    label: "PiAPI API Key",
    provider: "PiAPI",
    hint: "Used for Kling, Seedance video and GPT-Image-1 generation",
    docsUrl: "https://piapi.ai/workspace/api-key",
  },
  {
    id: "OPENROUTER_API_KEY",
    label: "OpenRouter API Key",
    provider: "OpenRouter",
    hint: "Alternative to Google AI key — routes Nano Banana image generation through OpenRouter when set",
    docsUrl: "https://openrouter.ai/settings/keys",
  },
  {
    id: "FAL_API_KEY",
    label: "fal.ai API Key",
    provider: "fal.ai",
    hint: "Used for FLUX Kontext — style transfer & multi-image editing",
    docsUrl: "https://fal.ai/dashboard/keys",
  },
];

// ── Image provider toggle ────────────────────────────────────────────────────
// Which backend handles Nano Banana (Gemini) image generation — explicit, not auto-detected.

const IMAGE_PROVIDERS = ["google", "openrouter"] as const;

// ── GET — return masked key info ───────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const reveal = req.nextUrl.searchParams.get("reveal");
  const env = readEnv();

  if (reveal) {
    const val = env[reveal] ?? process.env[reveal] ?? "";
    return NextResponse.json({ value: val });
  }

  const keys = KEY_DEFS.map(def => {
    const val = env[def.id] ?? process.env[def.id] ?? "";
    return {
      ...def,
      masked: mask(val),
      set: val.length > 0,
    };
  });

  const imageProvider = env.IMAGE_PROVIDER ?? process.env.IMAGE_PROVIDER ?? "google";

  return NextResponse.json({ keys, imageProvider });
}

// ── POST — update a key or config value in .env.local ──────────────────────────

export async function POST(req: NextRequest) {
  const { key, value } = (await req.json()) as { key: string; value: string };
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  if (key === "IMAGE_PROVIDER") {
    if (!IMAGE_PROVIDERS.includes(value as (typeof IMAGE_PROVIDERS)[number]))
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

    const env = readEnv();
    env.IMAGE_PROVIDER = value;
    writeEnv(env);
    process.env.IMAGE_PROVIDER = value;
    return NextResponse.json({ ok: true, imageProvider: value });
  }

  const allowed = KEY_DEFS.map(d => d.id);
  if (!allowed.includes(key))
    return NextResponse.json({ error: "Unknown key" }, { status: 400 });

  const env = readEnv();
  if (value) {
    env[key] = value;
  } else {
    delete env[key];
  }
  writeEnv(env);

  // Apply immediately (takes effect on next request, no restart needed for most APIs)
  process.env[key] = value;

  return NextResponse.json({ ok: true, masked: mask(value), set: value.length > 0 });
}
