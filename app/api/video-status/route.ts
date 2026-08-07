import { NextRequest, NextResponse } from "next/server";
import { getPiAPITaskStatus } from "@/lib/piapi";

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  const endpoint = req.nextUrl.searchParams.get("endpoint") ?? "text2video";

  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  try {
    // ── PiAPI path ──────────────────────────────────────────────────────────
    if (endpoint === "piapi") {
      const result = await getPiAPITaskStatus(taskId);
      const data = result.data as Record<string, unknown> | undefined;
      const rawStatus = (data?.status as string | undefined)?.toLowerCase() ?? "processing";
      const output = data?.output as Record<string, unknown> | undefined;

      // Try multiple paths PiAPI uses for video URL depending on model/version
      type Works = Array<{ video?: { resource?: string; resource_without_watermark?: string } }>;
      const works = output?.works as Works | undefined;
      const videoUrl: string | null =
        (typeof output?.video === "string" ? output.video : null) ??
        works?.[0]?.video?.resource_without_watermark ??
        works?.[0]?.video?.resource ??
        (output?.video_url as string | undefined) ??
        null;

      // Normalise PiAPI status → what the frontend expects
      const status =
        rawStatus === "completed" ? "succeed" :
        rawStatus === "failed"    ? "failed"  :
        rawStatus === "succeed"   ? "succeed" :
        rawStatus === "success"   ? "succeed" :
        rawStatus;

      if (rawStatus === "completed" || rawStatus === "succeed" || rawStatus === "success") {
        console.log("[PiAPI] ✓ task complete — output:", JSON.stringify(output, null, 2));
        console.log("[PiAPI] ✓ resolved videoUrl:", videoUrl);
      }

      return NextResponse.json({ status, videoUrl });
    }

    return NextResponse.json({ error: "Unknown endpoint" }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
