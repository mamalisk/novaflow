import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { SLUG_MAP, knowledgeDir } from "../../../../lib/knowledge-docs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const filename = SLUG_MAP.get(slug);
  if (!filename) return NextResponse.json({ error: "Unknown document" }, { status: 404 });

  const filePath = join(knowledgeDir(), filename);
  const exists = existsSync(filePath);
  const content = exists ? readFileSync(filePath, "utf-8") : "";

  return NextResponse.json({ slug, filename, exists, content });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const filename = SLUG_MAP.get(slug);
  if (!filename) return NextResponse.json({ error: "Unknown document" }, { status: 404 });

  const body = await req.json() as { content?: string };
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content (string) is required" }, { status: 400 });
  }

  const dir = knowledgeDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), body.content, "utf-8");

  return NextResponse.json({ ok: true });
}
