import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";

const TL_DIR = path.join(process.cwd(), "public", "timelines");

// POST — save a keyframe image or transition video
export async function POST(req: NextRequest) {
  const { projectId, keyframeId, image, videoUrl, isTransition } = await req.json() as {
    projectId: string;
    keyframeId: string;
    image?: string;
    videoUrl?: string;
    isTransition?: boolean;
  };

  const dir = path.join(TL_DIR, projectId);
  await mkdir(dir, { recursive: true });

  if (image) {
    const b64 = image.replace(/^data:image\/\w+;base64,/, "");
    const filename = `${keyframeId}.png`;
    await writeFile(path.join(dir, filename), Buffer.from(b64, "base64"));
    return NextResponse.json({ path: `/timelines/${projectId}/${filename}` });
  }

  if (videoUrl && isTransition) {
    try {
      const res = await fetch(videoUrl);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const filename = `${keyframeId}.mp4`;
        await writeFile(path.join(dir, filename), buf);
        return NextResponse.json({ path: `/timelines/${projectId}/${filename}` });
      }
    } catch { /* fall through */ }
    return NextResponse.json({ path: videoUrl }); // fallback: keep external URL
  }

  return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
}

// DELETE — remove a keyframe image file
export async function DELETE(req: NextRequest) {
  const { projectId, keyframeId } = await req.json() as { projectId: string; keyframeId: string };
  const imgPath = path.join(TL_DIR, projectId, `${keyframeId}.png`);
  await unlink(imgPath).catch(() => {});
  return NextResponse.json({ ok: true });
}
