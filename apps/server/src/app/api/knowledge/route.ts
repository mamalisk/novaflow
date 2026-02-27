import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { KNOWLEDGE_DOCS, knowledgeDir } from "../../../lib/knowledge-docs";

export async function GET() {
  const dir = knowledgeDir();
  const docs = KNOWLEDGE_DOCS.map(({ slug, filename, title }) => ({
    slug,
    title,
    exists: existsSync(join(dir, filename)),
  }));
  return NextResponse.json({ docs });
}
