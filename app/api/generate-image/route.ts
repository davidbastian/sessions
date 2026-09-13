import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { getModelById } from "@/config/models";
import { say } from "@/lib/skills";

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
      const stylePrompt = [
        say("style-transfer", "Instruction"),
        prompt?.trim() ? say("style-transfer", "Direction", { direction: prompt.trim() }) : "",
      ].filter(Boolean).join("\n\n");

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
        falPrompt = [
          say("style-transfer", "Instruction"),
          say("style-transfer", "Single output"),
          prompt?.trim() ? say("style-transfer", "Direction", { direction: prompt.trim() }) : "",
        ].filter(Boolean).join("\n\n");
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
      screenDescription = await describeImage(screenImage, say("image-prompt", "Screen: describe"));
    }

    function styleTransferPrompt(userTarget: string | undefined) {
      return [
        say("style-transfer", "Instruction"),
        userTarget ? say("style-transfer", "Direction", { direction: userTarget }) : "",
        aspectRatio ? say("image-prompt", "Ratio", { aspectRatio }) : "",
      ].filter(Boolean).join("\n\n");
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

      const momentPrompt = say("moment", "Instruction", {
        timeLabel,
        context: userContext ? `\nAdditional context from the user: "${userContext}"` : "",
        lead: say("moment", momentDirection === "before" ? "Before" : "After"),
      }) + (aspectRatio ? `\n${say("image-prompt", "Ratio", { aspectRatio })}` : "");

      parts.push({ text: momentPrompt });

    } else if (genType === "character-transfer") {
      // Character Transfer — replace one or more characters in a scene using reference photos
      // Image order: [text instruction] → [scene image?] → [char1] → [char2] → ...
      const charStart = sceneImage ? 2 : 1;
      const charLabels = characterImages.map((_, i) =>
        `image ${charStart + i} = Character ${i + 1}`
      ).join(", ");

      const userInstruction = prompt?.trim();
      const transferPrompt = say("character-transfer", "Instruction", {
        sceneLine: say("character-transfer", sceneImage ? "Scene: given" : "Scene: none"),
        charactersLine: characterImages.length
          ? [
              say("character-transfer", "Characters", { labels: charLabels }),
              keepClothes ? say("character-transfer", "Clothes: keep") : "",
              keepPose ? say("character-transfer", "Pose: keep") : "",
            ].filter(Boolean).join(" ")
          : "",
        userInstruction: userInstruction || "Replace the main character(s) with the provided character reference(s).",
        poseRule: say("character-transfer", keepPose ? "Pose: keep" : "Pose: scene"),
        clothesRule: say("character-transfer", keepClothes ? "Clothes: keep" : "Clothes: scene"),
      }) + (aspectRatio ? `\n- Generate in ${aspectRatio} aspect ratio` : "");

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
        ? `${prompt}\n\n${say("image-prompt", "Ratio", { aspectRatio })}`
        : prompt;

      if (imageRef) {
        fullPrompt += `\n\n${say("image-prompt", "Reference", { label: imgLabel ?? "" })}`;
      }

      if (effectImage) {
        const userPromptLower = (prompt ?? "").toLowerCase();
        const targetKeywords = ["person", "people", "figure", "human", "face", "character",
          "background", "sky", "foreground", "object", "animal", "subject", "only", "just",
          "specific", "area", "element", "part", "region"];
        const hasTarget = targetKeywords.some(kw => userPromptLower.includes(kw));

        fullPrompt += `\n\n${say("image-prompt", hasTarget ? "Effect: targeted" : "Effect: everywhere", { label: effLabel ?? "" })}`;
      }

      // Screen image: use text description (avoids content-blocking on UI/logo screenshots)
      if (screenDescription) {
        fullPrompt += `\n\n${say("image-prompt", "Screen", { screen: screenDescription })}`;
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
        describeImage(styleImage!, say("refusals", "Describe: style")),
        describeImage(contentImage!, say("refusals", "Describe: content")),
      ]);

      const userTarget = prompt?.trim();
      const fallbackPrompt = [
        say("refusals", "From words", {
          style: styleDescription || "Use the art direction from the style reference.",
          content: contentDescription || "Use the subject from the content reference.",
        }),
        userTarget ? `TARGETING INSTRUCTION: "${userTarget}" — if it refers to a specific area/subject, apply the style only there; otherwise apply it globally.` : "",
        aspectRatio ? say("image-prompt", "Ratio", { aspectRatio }) : "",
      ].filter(Boolean).join("\n\n");

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
