import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

const SESSIONS_DIR = path.join(process.cwd(), "public", "sessions");
const SESSIONS_FILE = path.join(SESSIONS_DIR, "sessions.json");

interface Generation {
  id: string;
  timestamp: string;
  prompt: string;
  genType: string;
  model: Record<string, unknown>;
  aspectRatio: string;
  images: string[];
  videoUrl?: string | null;
  videoStatus?: string | null;
}

interface Session {
  id: string;
  createdAt: string;
  title: string;
  generations: Generation[];
}

interface SessionsData {
  sessions: Session[];
}

async function load(): Promise<SessionsData> {
  try {
    const data: SessionsData = JSON.parse(await readFile(SESSIONS_FILE, "utf-8"));
    // Deduplicate sessions by id (merge generations), in case of past race conditions
    const seen = new Map<string, Session>();
    for (const s of data.sessions) {
      if (seen.has(s.id)) {
        const existing = seen.get(s.id)!;
        const genIds = new Set(existing.generations.map(g => g.id));
        for (const g of s.generations) if (!genIds.has(g.id)) existing.generations.push(g);
      } else {
        seen.set(s.id, { ...s, generations: [...s.generations] });
      }
    }
    return { sessions: [...seen.values()] };
  } catch {
    return { sessions: [] };
  }
}

async function persist(data: SessionsData) {
  await mkdir(SESSIONS_DIR, { recursive: true });
  await writeFile(SESSIONS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// POST — save a completed generation (with optional base64 images)
export async function POST(req: NextRequest) {
  const { sessionId, generation, images } = await req.json() as {
    sessionId: string;
    generation: Generation;
    images: string[];
  };

  const data = await load();
  const sessionDir = path.join(SESSIONS_DIR, sessionId);
  await mkdir(sessionDir, { recursive: true });

  // Write image files to disk and build public paths
  const publicPaths: string[] = [];
  if (images?.length) {
    for (let i = 0; i < images.length; i++) {
      const b64 = images[i].replace(/^data:image\/\w+;base64,/, "");
      const filename = `${generation.id}-${i}.png`;
      await writeFile(path.join(sessionDir, filename), Buffer.from(b64, "base64"));
      publicPaths.push(`/sessions/${sessionId}/${filename}`);
    }
  }

  // Download external video URL and store locally
  let localVideoUrl = generation.videoUrl ?? null;
  if (generation.videoUrl?.startsWith("http")) {
    try {
      const videoRes = await fetch(generation.videoUrl);
      if (videoRes.ok) {
        const buf = Buffer.from(await videoRes.arrayBuffer());
        const filename = `${generation.id}.mp4`;
        await writeFile(path.join(sessionDir, filename), buf);
        localVideoUrl = `/sessions/${sessionId}/${filename}`;
      }
    } catch { /* keep external URL as fallback */ }
  }

  const savedGen: Generation = { ...generation, images: publicPaths, videoUrl: localVideoUrl };

  // Find or create session
  let session = data.sessions.find(s => s.id === sessionId);
  if (!session) {
    const titleCandidate = generation.genType !== "user-upload" ? (generation.prompt?.slice(0, 60) || "") : "";
    session = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      title: titleCandidate || "Session",
      generations: [],
    };
    data.sessions.unshift(session);
  }

  session.generations.push(savedGen);

  // Update title from first real (non-upload) prompt if not already meaningful
  const staleTitle = !session.title || session.title === "Session" || session.title === "Uploaded image";
  if (staleTitle && generation.genType !== "user-upload" && generation.prompt) {
    session.title = generation.prompt.slice(0, 60);
  }

  await persist(data);
  return NextResponse.json({ session, publicImagePaths: publicPaths });
}
