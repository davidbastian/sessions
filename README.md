# Sessions

A session-based workspace that unifies image and video generation across multiple state-of-the-art AI models. Designed and built end to end by [David Bastian](https://davidbastian.red): architecture, API layer, and every interaction.

More of my work: [davidbastian.black](https://davidbastian.black) (interaction studies) · [davidbastian.red](https://davidbastian.red) (commercial work)

## What it is

Most AI generation tools are a prompt box bolted onto one API. Sessions is built around how creatives actually work: iterating in sessions, mixing references, moving between models without losing context.

- **Session-based workspace.** Every generation lives in a session you can revisit, compare, and continue.
- **Multi-model.** Image and video across providers (Google Gemini / Nano Banana, Kling, Seedance) behind one interface.
- **Generation modes built for intent**, each with its own prompt logic and model routing:
  - **Style Transfer** — apply the visual direction of a reference to new content
  - **Characters** — transplant a person or illustrated character into a new scene (including Seedance character-replace in a reference video)
  - **Moment** — generate what happened before or after a frozen frame
  - **Screen** — control exactly what a device screen displays inside a generated image
- **Video controls.** Start/end-frame keyframes, multiple resolutions, variable durations, timelines.
- **Reference-first inputs.** Every slot accepts drag-and-drop, asset-library picks, or live webcam capture.
- **Prompt improvement.** A dedicated endpoint that upgrades prompts before generation.

## Architecture notes

- **Config-driven model registry** (`config/models.ts`): adding a new model is a single entry — capabilities (start/end frame support, pro-mode requirements, resolutions, durations) are declared as data, and the router adapts. No other code changes.
- **Per-provider adapters** (`lib/kling.ts`, `lib/piapi.ts`) isolate API quirks from the UI.
- **Next.js App Router API layer** (`app/api/*`): generation, video status polling, sessions, timelines/keyframes, prompt improvement.

## Stack

Next.js · TypeScript · React · Google Generative AI · Kling · PiAPI (Seedance)

## Run it

```bash
cp .env.local.example .env.local   # add your API keys
npm install
npm run dev
```

Generated media is written to `public/sessions/` and `public/timelines/` (gitignored).

## Status

Personal tool, built for my own creative practice. Shared as-is so the code can be read; it is not packaged as a product.
