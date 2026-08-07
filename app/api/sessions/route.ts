import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import path from "path";

const SESSIONS_FILE = path.join(process.cwd(), "public", "sessions", "sessions.json");

interface Generation { id: string; prompt: string; genType: string; }
interface Session { id: string; title: string; generations: Generation[]; }

export async function GET() {
  try {
    const raw = await readFile(SESSIONS_FILE, "utf-8");
    const data = JSON.parse(raw) as { sessions: Session[] };

    // Auto-heal stale titles ("Uploaded image" / "Session" / empty)
    let dirty = false;
    for (const s of data.sessions) {
      const stale = !s.title || s.title === "Session" || s.title === "Uploaded image";
      if (stale) {
        const firstReal = s.generations.find(g => g.genType !== "user-upload" && g.prompt);
        if (firstReal) {
          s.title = firstReal.prompt.slice(0, 60);
          dirty = true;
        }
      }
    }
    if (dirty) await writeFile(SESSIONS_FILE, JSON.stringify(data, null, 2));

    return NextResponse.json(data);
  } catch {
    // File doesn't exist yet — return empty list
    return NextResponse.json({ sessions: [] });
  }
}
