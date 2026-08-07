import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

const TL_FILE = path.join(process.cwd(), "public", "timelines", "timelines.json");

export async function GET() {
  try {
    return NextResponse.json(JSON.parse(await readFile(TL_FILE, "utf-8")));
  } catch {
    return NextResponse.json({ projects: [] });
  }
}
