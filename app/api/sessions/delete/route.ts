import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, unlink } from "fs/promises";
import path from "path";

const SESSIONS_DIR = path.join(process.cwd(), "public", "sessions");
const SESSIONS_FILE = path.join(SESSIONS_DIR, "sessions.json");

// DELETE /api/sessions/delete  — soft-deletes a session (hidden from sidebar, assets kept)
// DELETE /api/sessions/delete?asset=1 with body { sessionId, genId } — hard-deletes one generation + its files
export async function DELETE(req: NextRequest) {
  const isAssetDelete = req.nextUrl.searchParams.get("asset") === "1";
  const body = await req.json() as { sessionId: string; genId?: string };
  const { sessionId, genId } = body;

  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const raw = await readFile(SESSIONS_FILE, "utf-8").catch(() => '{"sessions":[]}');
  const data = JSON.parse(raw) as { sessions: Array<{ id: string; deleted?: boolean; generations: Array<{ id: string; images: string[]; videoUrl?: string | null }> }> };

  if (isAssetDelete && genId) {
    // Hard-delete a single generation (and its files) from a session
    const session = data.sessions.find(s => s.id === sessionId);
    if (session) {
      const gen = session.generations.find(g => g.id === genId);
      if (gen) {
        // Delete image files
        for (const imgPath of gen.images) {
          const abs = path.join(process.cwd(), "public", imgPath);
          await unlink(abs).catch(() => {});
        }
        // Delete video file if local
        if (gen.videoUrl && gen.videoUrl.startsWith("/")) {
          await unlink(path.join(process.cwd(), "public", gen.videoUrl)).catch(() => {});
        }
        session.generations = session.generations.filter(g => g.id !== genId);
      }
    }
  } else {
    // Soft-delete the session — keep generations in place for Assets view
    const session = data.sessions.find(s => s.id === sessionId);
    if (session) session.deleted = true;
  }

  await writeFile(SESSIONS_FILE, JSON.stringify(data, null, 2));
  return NextResponse.json({ ok: true });
}
