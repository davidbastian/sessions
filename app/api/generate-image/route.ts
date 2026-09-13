import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { getModelById } from "@/config/models";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const prompt = formData.get("prompt") as string;
  const modelId = formData.get("modelId") as string;
  const aspectRatio = formData.get("aspectRatio") as string;
  const genType = (formData.get("genType") as string) ?? "prompt";
  const imageRef = formData.get("imageRef") as File | null;
  const effectImage = formData.get("effectImage") as File | null;
  const screenImage = formData.get("screenImage") as File | null;
  const styleImage = formData.get("styleImage") as File | null;
  const contentImage = formData.get("contentImage") as File | null;
  const momentImage = formData.get("momentImage") as File | null;
  const momentDirection = (formData.get("momentDirection") as string) ?? "before";
  const momentSeconds = parseInt((formData.get("momentSeconds") as string) ?? "2") || 2;
  // Character Transfer
  const sceneImage = formData.get("sceneImage") as File | null;
  const characterImages: File[] = [];
  for (let i = 1; i <= 5; i++) {
    const c = formData.get(`character${i}`) as File | null;
    if (c) characterImages.push(c);
  }
  const keepClothes = formData.get("keepClothes") === "1";
  const keepPose = formData.get("keepPose") === "1";

  // Validation
  if (genType === "prompt" && !prompt) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }
  if (genType === "style-transfer" && (!styleImage || !contentImage)) {
    return NextResponse.json({ error: "Both style and content images are required" }, { status: 400 });
  }
  if (genType === "moment" && !momentImage) {
    return NextResponse.json({ error: "Moment image is required" }, { status: 400 });
  }

  const modelConfig = getModelById(modelId);
  if (!modelConfig) {
    return NextResponse.json({ error: "Unknown model" }, { status: 400 });
  }

  // ── PiAPI image path (GPT-Image-2 etc.) ────────────────────────────────────
  if (modelConfig.apiProvider === "piapi-image") {
    const piKey = process.env.PIAPI_API_KEY;
    if (!piKey) return NextResponse.json({ error: "PIAPI_API_KEY not set" }, { status: 500 });

    // Map aspect ratio → supported size
    const sizeMap: Record<string, string> = {
      "1:1":  "1024x1024",
      "16:9": "1536x1024",
      "9:16": "1024x1536",
    };
    const size = sizeMap[aspectRatio] ?? "1024x1024";
    const modelName = modelConfig.apiModel ?? "gpt-image-2-preview";
    const authHeaders = { "Authorization": `Bearer ${piKey}` };

    let res: Response;

    if (genType === "style-transfer" && styleImage && contentImage) {
      // ── Style transfer → /v1/images/edits with two reference images ────────
      // gpt-image-2's edit endpoint accepts multiple images under the same "image"
      // field — first is treated as style, second as content to preserve.
      const stylePrompt = `The first image is the STYLE reference. The second image is the CONTENT image.

Re-render the content image exactly as it is — same subject, pose, framing, composition, and every detail — but entirely in the visual style of the first image: its art direction, color palette, lighting, texture, and overall aesthetic.

Do not change what is in the content image. Only change how it looks, to match the style image.${prompt?.trim() ? `\n\nAdditional direction: "${prompt.trim()}"` : ""}`;

      const fd = new FormData();
      fd.append("model", modelName);
      fd.append("prompt", stylePrompt);
      fd.append("n", "1");
      fd.append("size", size);
      fd.append("response_format", "b64_json");
      fd.append("image", styleImage, styleImage.name || "style.jpg");
      fd.append("image", contentImage, contentImage.name || "content.jpg");
      res = await fetch("https://api.piapi.ai/v1/images/edits", {
        method: "POST",
        headers: authHeaders,
        body: fd,
      });
    } else if (imageRef) {
      // ── With reference image → /v1/images/edits (multipart/form-data) ──────
      const fd = new FormData();
      fd.append("model", modelName);
      fd.append("prompt", prompt || "Edit the image");
      fd.append("n", "1");
      fd.append("size", size);
      fd.append("response_format", "b64_json");
      fd.append("image", imageRef, imageRef.name || "reference.jpg");
      res = await fetch("https://api.piapi.ai/v1/images/edits", {
        method: "POST",
        headers: authHeaders,
        body: fd,
      });
    } else {
      // ── Text-to-image → /v1/images/generations (JSON) ────────────────────
      res = await fetch("https://api.piapi.ai/v1/images/generations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelName, prompt: prompt || "Generate an image", n: 1, size, quality: "high", output_format: "jpeg" }),
      });
    }

    const text = await res.text();
    let data: Record<string, unknown>;
    try { data = JSON.parse(text); } catch { return NextResponse.json({ error: `PiAPI non-JSON: ${text.slice(0, 200)}` }, { status: 500 }); }
    if (!res.ok) return NextResponse.json({ error: `PiAPI error ${res.status}: ${JSON.stringify(data)}` }, { status: 500 });

    console.log("[PiAPI-image] response:", JSON.stringify(data).slice(0, 300));
    const images = ((data.data ?? []) as Array<{ b64_json?: string; url?: string }>)
      .map(d => {
        if (d.b64_json) return `data:image/jpeg;base64,${d.b64_json}`;
        if (d.url) return d.url;
        return "";
      })
      .filter(Boolean);
    return NextResponse.json({ images });
  }

  // ── fal.ai image path (FLUX Kontext — multi-image editing/style transfer) ──
  if (modelConfig.apiProvider === "fal-image") {
    const falKey = process.env.FAL_API_KEY;
    if (!falKey) return NextResponse.json({ error: "FAL_API_KEY not set" }, { status: 500 });

    const modelName = modelConfig.apiModel ?? "fal-ai/flux-pro/kontext/max/multi";
    const TIMEOUT_MS = 45000;

    // Upload to fal's CDN storage first — embedding raw base64 in the JSON body is
    // unreliable for real photo-sized files, so mirror what fal's own client SDKs do.
    async function uploadToFal(file: File): Promise<string> {
      const initRes = await fetch("https://rest.alpha.fal.ai/storage/upload/initiate", {
        method: "POST",
        headers: { "Authorization": `Key ${falKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content_type: file.type || "image/jpeg", file_name: file.name || "upload.jpg" }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!initRes.ok) {
        const body = await initRes.text().catch(() => "");
        throw new Error(`fal.ai upload-initiate failed (${initRes.status}): ${body.slice(0, 300)}`);
      }
      const { upload_url, file_url } = await initRes.json() as { upload_url: string; file_url: string };

      const buf = Buffer.from(await file.arrayBuffer());
      const putRes = await fetch(upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: buf,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!putRes.ok) throw new Error(`fal.ai upload-put failed: ${putRes.status}`);

      return file_url;
    }

    try {
      const imageUrls: string[] = [];
      let falPrompt = prompt || "";

      if (genType === "style-transfer" && styleImage && contentImage) {
        imageUrls.push(await uploadToFal(styleImage));
        imageUrls.push(await uploadToFal(contentImage));
        falPrompt = `Restyle image 2 using the visual style of image 1.

Take the exact subject, pose, framing, and composition from image 2, and re-render it entirely in the art direction, color palette, lighting, texture, and aesthetic of image 1.

Output ONE single image only — the restyled version of image 2. Do NOT show image 1 anywhere in the output, do NOT place the two images side by side or in a collage/grid, and do NOT crop or split the canvas. The result must be a single standalone image with the same framing as image 2.${prompt?.trim() ? `\n\nAdditional direction: "${prompt.trim()}"` : ""}`;
      } else if (imageRef) {
        imageUrls.push(await uploadToFal(imageRef));
        falPrompt = prompt || "Edit the image";
      } else {
        return NextResponse.json({ error: "FLUX Kontext requires at least one reference image — use Style Transfer, or attach a Ref image in Image Prompt mode." }, { status: 400 });
      }

      const res = await fetch(`https://fal.run/${modelName}`, {
        method: "POST",
        headers: { "Authorization": `Key ${falKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: falPrompt,
          image_urls: imageUrls,
          aspect_ratio: aspectRatio || "1:1",
          num_images: 1,
          output_format: "jpeg",
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const text = await res.text();
      let data: Record<string, unknown>;
      try { data = JSON.parse(text); } catch { return NextResponse.json({ error: `fal.ai non-JSON: ${text.slice(0, 200)}` }, { status: 500 }); }
      if (!res.ok) return NextResponse.json({ error: `fal.ai error ${res.status}: ${JSON.stringify(data).slice(0, 300)}` }, { status: 500 });

      console.log("[fal-image] response:", JSON.stringify(data).slice(0, 300));
      const images = ((data.images ?? []) as Array<{ url?: string }>)
        .map(d => d.url ?? "")
        .filter(Boolean);
      return NextResponse.json({ images });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "fal.ai request failed";
      console.warn("[fal-image] error:", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // ── Gemini path — direct via Google AI, or via OpenRouter — explicit toggle ─
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const imageProvider = process.env.IMAGE_PROVIDER === "openrouter" ? "openrouter" : "google";
  const useOpenRouter = imageProvider === "openrouter";

  if (useOpenRouter && !openRouterKey) {
    return NextResponse.json({ error: "Active provider is OpenRouter, but OPENROUTER_API_KEY is not set. Add it or switch provider in Settings." }, { status: 500 });
  }
  if (!useOpenRouter && !apiKey) {
    return NextResponse.json({ error: "Active provider is Google AI, but GOOGLE_AI_API_KEY is not set. Add it or switch provider in Settings." }, { status: 500 });
  }

  // OpenRouter model slugs for Gemini image models (image-output capable)
  const GEMINI_TO_OPENROUTER: Record<string, string> = {
    "gemini-3-pro-image-preview": "google/gemini-3-pro-image",
    "gemini-3.1-flash-image-preview": "google/gemini-3.1-flash-image",
  };
  const openRouterModel = GEMINI_TO_OPENROUTER[modelConfig.apiModel ?? ""] ?? "google/gemini-3-pro-image";

  try {
    const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
    const model = genAI?.getGenerativeModel({
      model: modelConfig.apiModel ?? "gemini-3-pro-image-preview",
    });

    // Pre-describe images via text model to avoid content-blocking on photos/art/screenshots
    // (only available when a Google key is configured — OpenRouter key alone can't drive this)
    const visionModel = genAI?.getGenerativeModel({ model: "gemini-2.0-flash" });

    async function describeImage(file: File, instruction: string): Promise<string> {
      if (!visionModel) return "";
      try {
        const buf = Buffer.from(await file.arrayBuffer());
        const res = await visionModel.generateContent([
          { inlineData: { mimeType: file.type, data: buf.toString("base64") } },
          { text: instruction },
        ]);
        return res.response.text()?.trim() ?? "";
      } catch { return ""; }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function callOpenRouter(parts: any[]): Promise<{ images: string[]; text: string }> {
      const content = parts.map(p =>
        p.text
          ? { type: "text", text: p.text }
          : { type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } }
      );
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: openRouterModel,
          messages: [{ role: "user", content }],
          modalities: ["image", "text"],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);

      const msg = data.choices?.[0]?.message;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const images = ((msg?.images ?? []) as any[])
        .map(img => img?.image_url?.url ?? img?.url ?? "")
        .filter(Boolean);
      const text = typeof msg?.content === "string" ? msg.content : "";
      return { images, text };
    }

    // Describe screen image for prompt mode
    let screenDescription = "";
    if (screenImage && genType === "prompt") {
      screenDescription = await describeImage(screenImage,
        "Describe this screen/UI content precisely for a visual artist who needs to reproduce it on a device screen in a photograph: what app or website is shown, its exact layout, colors, typography, text content, icons, buttons, images, and overall aesthetic. Be specific and detailed."
      );
    }

    function styleTransferPrompt(userTarget: string | undefined) {
      return `Image 1 is the STYLE reference. Image 2 is the CONTENT image.

Re-render image 2 exactly as it is — same subject, pose, framing, composition, and every detail — but entirely in the visual style of image 1: its art direction, color palette, lighting, texture, and overall aesthetic.

Do not change what is in image 2. Only change how it looks, to match image 1's style.${userTarget ? `\n\nAdditional direction from the user: "${userTarget}"` : ""}${aspectRatio ? `\nGenerate in ${aspectRatio} aspect ratio.` : ""}`;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function buildDirectParts(): Promise<any[]> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts: any[] = [];

      if (genType === "style-transfer") {
        // Text first, then images — real images give the best fidelity when Gemini accepts them
        parts.push({ text: styleTransferPrompt(prompt?.trim()) });

        const styleBuffer = Buffer.from(await styleImage!.arrayBuffer());
        parts.push({ inlineData: { mimeType: styleImage!.type, data: styleBuffer.toString("base64") } });

        const contentBuffer = Buffer.from(await contentImage!.arrayBuffer());
        parts.push({ inlineData: { mimeType: contentImage!.type, data: contentBuffer.toString("base64") } });

        return parts;
      }

      return buildOtherParts();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function buildOtherParts(): Promise<any[]> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts: any[] = [];

    if (genType === "moment") {
      // Moment mode — generate what happened before or after the captured frame
      const buffer = Buffer.from(await momentImage!.arrayBuffer());
      parts.push({ inlineData: { mimeType: momentImage!.type, data: buffer.toString("base64") } });

      const timeLabel = `${momentSeconds} second${momentSeconds !== 1 ? "s" : ""} ${momentDirection}`;
      const userContext = prompt?.trim();
      const contextBlock = userContext ? `\nAdditional context from the user: "${userContext}"` : "";

      const momentPrompt = `[MOMENT GENERATION]
The attached image is a captured frame — a single frozen moment in time (T=0).${contextBlock}

Generate a realistic, photorealistic image showing what this scene looked like exactly ${timeLabel} this captured moment.

Critical requirements:
- Keep every subject (people, athletes, animals, objects) visually IDENTICAL — same faces, clothing, body type, colors, and physical characteristics. Do not change how anyone looks.
- Maintain the exact same location, background, environment, and camera angle/framing.
- Maintain consistent lighting direction, quality, and color temperature.
- Show the PHYSICALLY REALISTIC action that would naturally occur ${timeLabel} this moment — based on the physics and narrative logic of what is shown in the image.
  ${momentDirection === "before"
    ? "This means: show the lead-up, anticipation, or preparation that would precede this moment."
    : "This means: show the natural physical consequence, continuation, or aftermath of this moment."}
- The result should feel indistinguishable from a real adjacent frame of the same video or photo sequence.
${aspectRatio ? `- Generate in ${aspectRatio} aspect ratio.` : ""}`;

      parts.push({ text: momentPrompt });

    } else if (genType === "character-transfer") {
      // Character Transfer — replace one or more characters in a scene using reference photos
      // Image order: [text instruction] → [scene image?] → [char1] → [char2] → ...
      const charStart = sceneImage ? 2 : 1;
      const charLabels = characterImages.map((_, i) =>
        `image ${charStart + i} = Character ${i + 1}`
      ).join(", ");

      const userInstruction = prompt?.trim();
      const transferPrompt = `[CHARACTER TRANSFER]
${sceneImage
  ? "The first attached image is the SCENE REFERENCE — preserve its composition, background, lighting direction, color palette, atmosphere, and overall aesthetic exactly. Do not change anything that isn't a character being replaced."
  : "Generate a photorealistic scene based on the user instruction below."}
${characterImages.length > 0
  ? `Character reference images: ${charLabels}
For each character reference, extract and faithfully reproduce: exact face shape, skin tone, eyes, hair color/style, and any distinctive physical features. The replacement must look like the actual person in the reference photo.${keepClothes ? " Also reproduce their clothing exactly as shown in their reference photo — same garments, colors, and style." : ""}${keepPose ? " Also reproduce their body pose exactly as shown in their reference photo." : ""}`
  : ""}

User instruction: "${userInstruction || "Replace the main character(s) with the provided character reference(s)."}"

Requirements:
- Match the scene reference's exact art style and rendering — whether photorealistic, illustrated, painted, anime, or otherwise. The output must look consistent with the scene's aesthetic, not forced into photorealism if the scene isn't photorealistic.
- ${keepPose
    ? "Keep each character's ORIGINAL pose and body position from their reference photo — do not change it to match the scene's pose. Adapt the scene composition around the character's actual pose instead."
    : "Give the character the pose described in the user instruction above. If the user instruction doesn't describe a pose, match the scene's original pose and body position instead."}
- ${keepClothes
    ? "Keep each character's ORIGINAL clothing from their reference photo — do not change it to match the scene's clothing style."
    : "Match the scene's original clothing style for each replaced character."}
- Keep the original lighting hitting each character from the same direction and with the same quality as the scene
- Do not alter the background, environment, or any non-character elements${aspectRatio ? `\n- Generate in ${aspectRatio} aspect ratio` : ""}`;

      // Text first, then images
      parts.push({ text: transferPrompt });

      if (sceneImage) {
        const buf = Buffer.from(await sceneImage.arrayBuffer());
        parts.push({ inlineData: { mimeType: sceneImage.type, data: buf.toString("base64") } });
      }
      for (const char of characterImages) {
        const buf = Buffer.from(await char.arrayBuffer());
        parts.push({ inlineData: { mimeType: char.type, data: buf.toString("base64") } });
      }

    } else {
      // Prompt mode — optional reference image, effect image, and/or screen image
      // Build text prompt first, then append images.
      // Gemini generates more reliably when the text instruction comes before image parts.

      // Assign labels in the order they'll be appended: imageRef → effectImage
      const total    = [imageRef, effectImage].filter(Boolean).length;
      const imgIdx   = imageRef    ? 1 : 0;
      const effIdx   = effectImage ? imgIdx + 1 : 0;
      const imgLabel = imageRef    ? (total > 1 ? `image ${imgIdx}` : "the attached image") : null;
      const effLabel = effectImage ? (total > 1 ? `image ${effIdx}` : "the attached image") : null;

      let fullPrompt = aspectRatio
        ? `${prompt}\n\n[Generate in ${aspectRatio} aspect ratio]`
        : prompt;

      if (imageRef) {
        fullPrompt += `\n\n[STYLE REFERENCE (${imgLabel}): Match its art direction, lighting setup, color palette, mood, texture, and overall aesthetic in the generated image. Treat it as the definitive visual reference for how the output should look and feel.]`;
      }

      if (effectImage) {
        const userPromptLower = (prompt ?? "").toLowerCase();
        const targetKeywords = ["person", "people", "figure", "human", "face", "character",
          "background", "sky", "foreground", "object", "animal", "subject", "only", "just",
          "specific", "area", "element", "part", "region"];
        const hasTarget = targetKeywords.some(kw => userPromptLower.includes(kw));

        if (hasTarget) {
          fullPrompt += `\n\n[EFFECT IMAGE (${effLabel}): Carefully analyze the visual effect or treatment shown — color grade, lighting, glow, particles, smoke, fog, grain, blur, vignette, filter, or texture overlay.
TARGETING: Apply this effect ONLY to the subjects/areas referenced in the user prompt. Leave everything else natural and unchanged. Integrate realistically so it looks like it belongs.]`;
        } else {
          fullPrompt += `\n\n[EFFECT IMAGE (${effLabel}): Carefully analyze the visual effect or treatment shown — color grade, lighting, glow, particles, smoke, fog, grain, blur, vignette, filter, or texture overlay.
Apply this exact effect across the ENTIRE generated image at the same type and intensity shown. Integrate it naturally so it looks like it belongs in the scene.]`;
        }
      }

      // Screen image: use text description (avoids content-blocking on UI/logo screenshots)
      if (screenDescription) {
        fullPrompt += `\n\n[DEVICE SCREEN: The screen of the device (phone, tablet, monitor, TV, etc.) must display the following UI content exactly. Render it faithfully with realistic screen glow, lighting, and any natural reflections appropriate to the environment. Do NOT use this as a style guide for the overall scene — apply it only to the device screen.

Screen content:
${screenDescription}]`;
      }

      // Text first, then images — Gemini works best with this order
      parts.push({ text: fullPrompt });

      if (imageRef) {
        const buffer = Buffer.from(await imageRef.arrayBuffer());
        parts.push({ inlineData: { mimeType: imageRef.type, data: buffer.toString("base64") } });
      }
      if (effectImage) {
        const buffer = Buffer.from(await effectImage.arrayBuffer());
        parts.push({ inlineData: { mimeType: effectImage.type, data: buffer.toString("base64") } });
      }
    }

      return parts;
    }

    // Retry up to 3 times — model sometimes returns zero candidates with image inputs
    async function attemptGenerate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parts: any[]
    ): Promise<{ images: string[]; text: string; lastError: string }> {
      let images: string[] = [];
      let textResponse = "";
      let lastError = "";

      for (let attempt = 1; attempt <= 3; attempt++) {
        if (useOpenRouter) {
          try {
            const r = await callOpenRouter(parts);
            images = r.images;
            textResponse = r.text;
            if (images.length > 0) break; // Success
            lastError = "OpenRouter returned no images";
          } catch (e) {
            lastError = e instanceof Error ? e.message : "OpenRouter request failed";
            break; // Don't retry hard errors (auth, bad request, etc.)
          }
          if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (model as any).generateContent({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        });

        const response = result.response;
        const candidate = response.candidates?.[0];

        // Check for safety block
        const blockReason = response.promptFeedback?.blockReason;
        if (blockReason) {
          lastError = `Content blocked: ${blockReason}`;
          break; // No point retrying a safety block
        }

        images = [];
        textResponse = "";
        for (const part of candidate?.content?.parts ?? []) {
          if (part.inlineData) {
            images.push(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
          } else if (part.text) {
            textResponse += part.text;
          }
        }

        if (images.length > 0) break; // Success

        lastError = candidate?.finishReason ?? "no candidates";
        if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
      }

      return { images, text: textResponse, lastError };
    }

    const directParts = await buildDirectParts();
    let genResult = await attemptGenerate(directParts);

    // Style transfer with real photos/art sometimes gets blocked by the image model's safety
    // filter — fall back to describing both images via text first, then generating from that.
    if (genResult.images.length === 0 && genType === "style-transfer") {
      console.warn(`[generate-image] Direct style-transfer failed (${genResult.lastError}) — falling back to description-based generation`);
      const [styleDescription, contentDescription] = await Promise.all([
        describeImage(styleImage!,
          "Describe the visual style of this image in detail for an artist: art style (e.g. anime, photorealistic, oil painting, illustration), color palette, lighting quality and direction, shadows, texture, mood, atmosphere, and overall aesthetic. Focus purely on HOW it looks, not what it depicts."
        ),
        describeImage(contentImage!,
          "Describe the content and composition of this image precisely: subjects (people, objects, animals), their appearance, poses, positions, clothing, expressions, the background/environment, camera angle, and framing. Be specific and visual."
        ),
      ]);

      const userTarget = prompt?.trim();
      const fallbackPrompt = `Generate a new image that takes the visual style described below and applies it to the content described below.

STYLE (apply this aesthetic):
${styleDescription || "Use the art direction from the style reference."}

CONTENT (preserve this subject, pose, and composition):
${contentDescription || "Use the subject from the content reference."}
${userTarget ? `\nTARGETING INSTRUCTION: "${userTarget}" — if it refers to a specific area/subject, apply the style only there; otherwise apply it globally.` : ""}
${aspectRatio ? `Generate in ${aspectRatio} aspect ratio.` : ""}`;

      genResult = await attemptGenerate([{ text: fallbackPrompt }]);
    }

    if (genResult.images.length === 0 && genResult.lastError) {
      console.warn(`[generate-image] All retries failed — ${genResult.lastError}`);
    }

    return NextResponse.json({ images: genResult.images, text: genResult.text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
