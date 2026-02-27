"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { marked } from "marked";
import Link from "next/link";
import styles from "./page.module.css";

// ─── Document registry ────────────────────────────────────────────────────────

const DOCS = [
  { slug: "architecture",        title: "Architecture",               description: "System architecture, key components, and design decisions" },
  { slug: "coding-conventions",  title: "Coding Conventions",         description: "Code style, naming, and best practices" },
  { slug: "test-strategy",       title: "Test Strategy",              description: "Testing approach, frameworks, and coverage expectations" },
  { slug: "definition-of-ready", title: "Definition of Ready",        description: "Criteria a ticket must meet before development starts" },
  { slug: "definition-of-done",  title: "Definition of Done",         description: "Criteria that must be met for a ticket to be complete" },
  { slug: "git-strategy",        title: "Git Strategy",               description: "Branching model, commit conventions, and PR workflow" },
  { slug: "nfr",                  title: "Non-Functional Requirements", description: "Performance, security, accessibility, and observability" },
  { slug: "component-library",   title: "Component Library",          description: "UI components, design tokens, and usage patterns" },
] as const;

type Slug = (typeof DOCS)[number]["slug"];

const PLACEHOLDERS: Record<Slug, string> = {
  architecture: `# Architecture

## Overview

Describe the high-level system architecture here.

## Key Components

- **Component A** — purpose
- **Component B** — purpose

## Design Decisions

### Decision: [title]
**Context:** Why this decision was needed.
**Decision:** What was decided.
**Rationale:** Why this option was chosen.
`,
  "coding-conventions": `# Coding Conventions

## Language & Runtime

- TypeScript (strict mode enabled)
- Node.js 20+

## Naming

- Files: \`kebab-case.ts\`
- Classes: \`PascalCase\`
- Functions / variables: \`camelCase\`
- Constants: \`SCREAMING_SNAKE_CASE\`

## Code Style

- No default exports in library code
- Prefer \`const\` over \`let\`
- Max function length: 50 lines
`,
  "test-strategy": `# Test Strategy

## Testing Pyramid

- **Unit** — vitest, isolated functions and modules
- **Integration** — supertest, API routes and DB interactions
- **E2E** — Playwright, critical user journeys

## Coverage Requirements

- Unit: 80% line coverage minimum
- Critical paths (auth, payments): 100%

## Test Naming

\`describe('ComponentName', () => { it('should ...', ...) })\`
`,
  "definition-of-ready": `# Definition of Ready

A ticket is **ready for development** when all of the following are true:

- [ ] Acceptance criteria are clearly defined
- [ ] Designs are available (Figma link attached)
- [ ] Dependencies identified and unblocked
- [ ] Estimated and prioritised in the backlog
- [ ] No open questions remain
`,
  "definition-of-done": `# Definition of Done

A ticket is **done** when all of the following are true:

- [ ] Code reviewed and approved (at least 1 approval)
- [ ] All automated tests pass (unit + integration + E2E)
- [ ] No new lint errors or type errors
- [ ] Relevant documentation updated
- [ ] Deployed to staging and smoke-tested
- [ ] JIRA ticket moved to Done
`,
  "git-strategy": `# Git Strategy

## Branching Model

| Branch | Purpose |
|---|---|
| \`main\` | Production-ready code |
| \`develop\` | Integration branch |
| \`feature/{ticket}-{desc}\` | Feature work |
| \`fix/{ticket}-{desc}\` | Bug fixes |

## Commit Convention

Format: \`{type}({scope}): {description}\`

Types: \`feat\` · \`fix\` · \`chore\` · \`docs\` · \`test\` · \`refactor\`

## Pull Requests

- Squash merge to \`develop\`
- At least 1 reviewer required
- CI must pass
`,
  nfr: `# Non-Functional Requirements

## Performance

- API p95 response time < 200 ms
- Page TTI < 2 s on a simulated 4G connection
- Max bundle size: 250 kB (gzipped)

## Security

- OWASP Top 10 compliance
- No secrets in source code (use environment variables)
- HTTPS enforced in production

## Accessibility

- WCAG 2.1 Level AA compliance
- All interactive elements keyboard-navigable

## Observability

- Structured JSON logging
- Error rate alerting at > 1% over 5 min
`,
  "component-library": `# Component Library

## Design Tokens

| Token | Value | Usage |
|---|---|---|
| \`--color-primary\` | \`#3b82f6\` | Buttons, links |
| \`--color-surface\` | \`#1e1e1e\` | Cards, panels |

## Components

### Button

\`\`\`tsx
<Button variant="primary" size="md">Click me</Button>
<Button variant="ghost">Cancel</Button>
\`\`\`

**Variants:** \`primary\` · \`ghost\` · \`danger\`
**Sizes:** \`sm\` · \`md\` · \`lg\`
`,
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocMeta {
  slug: Slug;
  title: string;
  exists: boolean;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function KnowledgePage() {
  const [docMeta, setDocMeta] = useState<DocMeta[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<Slug | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load doc status list on mount
  useEffect(() => {
    fetch("/api/knowledge")
      .then((r) => r.json() as Promise<{ docs: DocMeta[] }>)
      .then(({ docs }) => setDocMeta(docs))
      .catch(console.error);
  }, []);

  // Load content when a doc is selected
  const selectDoc = useCallback(async (slug: Slug) => {
    setSelectedSlug(slug);
    setMode("edit");
    setSaveMsg("");

    const res = await fetch(`/api/knowledge/${slug}`);
    const data = await res.json() as { content: string };
    setContent(data.content);
    setSavedContent(data.content);
  }, []);

  const isDirty = content !== savedContent;

  async function save() {
    if (!selectedSlug || saving) return;
    setSaving(true);
    setSaveMsg("");

    try {
      await fetch(`/api/knowledge/${selectedSlug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      setSavedContent(content);
      setSaveMsg("Saved");

      // Refresh existence status
      const r = await fetch("/api/knowledge");
      const { docs } = await r.json() as { docs: DocMeta[] };
      setDocMeta(docs);
    } catch {
      setSaveMsg("Save failed");
    } finally {
      setSaving(false);
    }
  }

  // Cmd/Ctrl+S to save
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const selectedDoc = DOCS.find((d) => d.slug === selectedSlug);

  return (
    <div className={styles.shell}>
      {/* Top bar */}
      <header className={styles.topBar}>
        <Link href="/" className={styles.topBarBack}>← Back</Link>
        <span className={styles.topBarSep}>|</span>
        <span className={styles.topBarTitle}>Knowledge Base</span>
      </header>

      <div className={styles.content}>
        {/* Document list */}
        <nav className={styles.docList}>
          <div className={styles.docListTitle}>Documents</div>
          {DOCS.map(({ slug, title }) => {
            const meta = docMeta.find((m) => m.slug === slug);
            return (
              <div
                key={slug}
                className={`${styles.docItem} ${selectedSlug === slug ? styles.docItemActive : ""}`}
                onClick={() => void selectDoc(slug)}
              >
                <span
                  className={`${styles.docDot} ${meta?.exists ? styles.docDotExists : styles.docDotMissing}`}
                />
                {title}
              </div>
            );
          })}
        </nav>

        {/* Editor / preview pane */}
        {selectedDoc ? (
          <div className={styles.editorPane}>
            <div className={styles.editorHeader}>
              <span className={styles.editorTitle}>{selectedDoc.title}</span>
              <div className={styles.editorHeaderRight}>
                <div className={styles.tabBar}>
                  <button
                    className={`${styles.tab} ${mode === "edit" ? styles.tabActive : ""}`}
                    onClick={() => setMode("edit")}
                  >
                    Edit
                  </button>
                  <button
                    className={`${styles.tab} ${mode === "preview" ? styles.tabActive : ""}`}
                    onClick={() => setMode("preview")}
                  >
                    Preview
                  </button>
                </div>
                <span className={isDirty ? styles.saveStatusDirty : styles.saveStatus}>
                  {isDirty ? "Unsaved changes" : saveMsg}
                </span>
                <button
                  className={styles.saveButton}
                  onClick={save}
                  disabled={saving || !isDirty}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            {mode === "edit" ? (
              <textarea
                ref={textareaRef}
                className={styles.textarea}
                value={content}
                onChange={(e) => { setContent(e.target.value); setSaveMsg(""); }}
                placeholder={PLACEHOLDERS[selectedSlug!]}
                spellCheck={false}
              />
            ) : (
              <div className={styles.preview}>
                {content ? (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: marked(content) as string,
                    }}
                  />
                ) : (
                  <p className={styles.previewEmpty}>Nothing to preview yet.</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className={styles.placeholder}>
            Select a document to edit
          </div>
        )}
      </div>
    </div>
  );
}
