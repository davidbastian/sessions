# AI Generator Studio — Setup Guide

## What this does
- **Image generation** with Google Nano Banana Pro / Nano Banana 2
- **Animation** with Kling AI (start frame → end frame)
- **Prompt improvement** powered by Gemini

---

## Step 1 — API Keys

### Google AI (Nano Banana + Gemini)
1. Go to https://aistudio.google.com
2. Sign in with your Google account
3. Click **"Get API Key"** → Create API Key
4. ⚠️ Enable billing on your Google Cloud project (required for Nano Banana image output — free tier only does text)

### Kling AI
1. Go to https://app.klingai.com/global/dev/api-key
2. Sign in (Google or email)
3. Click **"Create a new API Key"**
4. Copy **both** the Access Key and the Secret Key (secret is only shown once!)

---

## Step 2 — Configure env

```bash
cd ai-generator-studio
cp .env.local.example .env.local
```

Open `.env.local` and paste your keys:
```
GOOGLE_AI_API_KEY=...
KLING_ACCESS_KEY=...
KLING_SECRET_KEY=...
```

---

## Step 3 — Run

```bash
npm run dev
```

Open http://localhost:3000

---

## Adding a New Model (e.g. Seedance 2)

Open `config/models.ts` and uncomment / add a new entry at the bottom of the `MODELS` array:

```ts
{
  id: "seedance-2",
  name: "Seedance 2",
  provider: "ByteDance",
  type: "video",
  description: "Seedance 2 video generation",
  aspectRatios: ASPECT_RATIOS,
  supportsImageRef: true,
  supportsStartEndFrame: true,
  apiModel: "seedance-v2",
  enabled: true,
},
```

Then add the corresponding API call in `app/api/generate-video/route.ts` with a branch for the new provider.
That's it — the UI will automatically pick it up.
