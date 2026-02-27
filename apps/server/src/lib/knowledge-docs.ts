import { join } from "path";

export const KNOWLEDGE_DOCS = [
  { slug: "architecture",          filename: "architecture.md",          title: "Architecture" },
  { slug: "coding-conventions",    filename: "coding-conventions.md",    title: "Coding Conventions" },
  { slug: "test-strategy",         filename: "test-strategy.md",         title: "Test Strategy" },
  { slug: "definition-of-ready",   filename: "definition-of-ready.md",   title: "Definition of Ready" },
  { slug: "definition-of-done",    filename: "definition-of-done.md",    title: "Definition of Done" },
  { slug: "git-strategy",          filename: "git-strategy.md",          title: "Git Strategy" },
  { slug: "nfr",                   filename: "nfr.md",                   title: "Non-Functional Requirements" },
  { slug: "component-library",     filename: "component-library.md",     title: "Component Library" },
] as const;

export type KnowledgeSlug = (typeof KNOWLEDGE_DOCS)[number]["slug"];

export const SLUG_MAP: Map<string, string> = new Map(KNOWLEDGE_DOCS.map((d) => [d.slug, d.filename]));

export function knowledgeDir(): string {
  // NOVAFLOW_PROJECT_DIR is set by server.ts at startup to the user's project root.
  // process.cwd() in Next.js route handlers resolves to apps/server/, not the project root.
  return join(process.env.NOVAFLOW_PROJECT_DIR ?? process.cwd(), ".novaflow", "knowledge");
}
