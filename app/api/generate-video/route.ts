import { NextRequest, NextResponse } from "next/server";
import { createPiAPIVideoTask } from "@/lib/piapi";
import { getModelById } from "@/config/models";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const prompt = formData.get("prompt") as string;
  const modelId = formData.get("modelId") as string;
  const aspectRatio = (formData.get("aspectRatio") as string) || "16:9";
  const duration = parseInt((formData.get("duration") as string) || "5");
  const resolution = (formData.get("resolution") as string) || "720p";
  const startFrame = formData.get("startFrame") as File | null;
  const endFrame = formData.get("endFrame") as File | null;
  const characterReplace = formData.get("characterReplace") === "1";
  const referenceVideoUrl = (formData.get("referenceVideoUrl") as string | null) || undefined;

  if (!prompt && !characterReplace) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  const modelConfig = getModelById(modelId);
  if (!modelConfig) {
    return NextResponse.json({ error: "Unknown model" }, { status: 400 });
  }

  try {
    const allowedDurations = modelConfig.durations ?? [5, 10];
    const dur = allowedDurations.includes(duration) ? duration : allowedDurations[0];

    // Convert uploaded files to base64 data URLs for API consumption
    async function toDataUrl(file: File): Promise<string> {
      const buf = await file.arrayBuffer();
      const b64 = Buffer.from(buf).toString("base64");
      return `data:${file.type};base64,${b64}`;
    }

    let startFrameBase64: string | undefined;
    let endFrameBase64: string | undefined;

    if (startFrame) startFrameBase64 = Buffer.from(await startFrame.arrayBuffer()).toString("base64");
    if (endFrame) endFrameBase64 = Buffer.from(await endFrame.arrayBuffer()).toString("base64");

    let taskId: string;
    let endpoint: string;

    if (modelConfig.apiProvider === "piapi") {
      // ── PiAPI path (Kling 3.0, Kling o1, Seedance 2) ─────────────────────
      if (!process.env.PIAPI_API_KEY) {
        return NextResponse.json({ error: "PIAPI_API_KEY not set — add it in Settings" }, { status: 500 });
      }

      const imageUrl = startFrame ? await toDataUrl(startFrame) : undefined;
      const imageTailUrl = endFrame ? await toDataUrl(endFrame) : undefined;

      console.log("[generate-video] PiAPI params:", {
        modelId, taskType: modelConfig.piAPITaskType, version: modelConfig.piAPIVersion,
        resolution: modelConfig.resolutions ? resolution : undefined,
        duration: dur, aspectRatio,
        hasStartFrame: !!startFrame, hasEndFrame: !!endFrame,
        characterReplace, referenceVideoUrl,
      });

      const task = await createPiAPIVideoTask({
        model: modelConfig.apiModel ?? "kling",
        taskType: modelConfig.piAPITaskType ?? "omni_video_generation",
        version: modelConfig.piAPIVersion,
        prompt, aspectRatio, duration: dur,
        resolution: modelConfig.resolutions ? resolution : undefined,
        imageUrl,
        imageTailUrl: modelConfig.supportsEndFrame ? imageTailUrl : undefined,
        characterReplace: modelConfig.supportsCharacterReplace ? characterReplace : undefined,
        videoUrl: modelConfig.supportsCharacterReplace ? referenceVideoUrl : undefined,
      });

      const piData = (task as { data?: { task_id?: string } }).data;
      if (!piData?.task_id) {
        return NextResponse.json({ error: `PiAPI: no task_id returned: ${JSON.stringify(task)}` }, { status: 500 });
      }
      taskId = piData.task_id;
      endpoint = "piapi";

    } else {
      return NextResponse.json({ error: "Model does not support video generation" }, { status: 400 });
    }

    return NextResponse.json({ taskId, status: "submitted", endpoint });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
