import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

const TL_DIR = path.join(process.cwd(), "public", "timelines");
const TL_FILE = path.join(TL_DIR, "timelines.json");

interface TLProject { id: string; [key: string]: unknown; }

export async function POST(req: NextRequest) {
  const { project } = await req.json() as { project: TLProject };
  await mkdir(TL_DIR, { recursive: true });

  let data: { projects: TLProject[] } = { projects: [] };
  try { data = JSON.parse(await readFile(TL_FILE, "utf-8")); } catch {}

  const idx = data.projects.findIndex(p => p.id === project.id);
  if (idx >= 0) data.projects[idx] = project;
  else data.projects.unshift(project);

  await writeFile(TL_FILE, JSON.stringify(data, null, 2));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { projectId } = await req.json() as { projectId: string };
  let data: { projects: TLProject[] } = { projects: [] };
  try { data = JSON.parse(await readFile(TL_FILE, "utf-8")); } catch {}
  data.projects = data.projects.filter(p => p.id !== projectId);
  await writeFile(TL_FILE, JSON.stringify(data, null, 2));
  return NextResponse.json({ ok: true });
}
