import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { prompt, type, images } = await req.json() as {
    prompt: string;
    type: "image" | "video";
    images?: { mimeType: string; data: string }[]; // base64 context images
  };

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_AI_API_KEY not set" }, { status: 500 });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    const hasImages = images && images.length > 0;

    const systemInstructions =
      type === "video"
        ? `You are an expert at writing prompts for AI video generators (like Kling AI).
${hasImages ? "You have been given the start and/or end frame images the user wants to animate. Use them to write a highly specific, cinematic prompt describing the motion, transformation, and visual journey between those frames." : ""}
Expand the user's rough idea into a detailed, vivid, cinematic prompt.
Focus on: camera movement, lighting, mood, motion, timing, visual style, scene details.
Keep it under 300 words. Return ONLY the improved prompt, no explanation.`
        : `You are an expert at writing prompts for AI image generators (like Google Imagen).
${hasImages ? "You have been given a reference image the user wants to use as a style guide. Use it to write a prompt that captures the exact visual style, lighting, color palette, and mood of that reference." : ""}
Expand the user's rough idea into a detailed, rich, descriptive prompt.
Focus on: visual style, lighting, composition, color palette, mood, details, artistic references.
Keep it under 200 words. Return ONLY the improved prompt, no explanation.`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [];

    // Add context images first (start frame, end frame, or style ref)
    if (hasImages) {
      for (const img of images!) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
      }
    }

    parts.push({ text: `${systemInstructions}\n\nUser prompt: "${prompt || "(no text — infer from the image(s))"}"` });

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
    });

    const improved = result.response.text().trim();
    return NextResponse.json({ improved });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
