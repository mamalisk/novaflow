import { readFileSync } from "fs";
import * as path from "path";

// ─── ChromaDB v2 REST client ──────────────────────────────────────────────────

interface ChromaQueryResult {
  documents: (string | null)[][];
  distances?: number[][];
}

export class KnowledgeBase {
  private host: string;
  private port: number;
  private prefix: string;
  /** Collection ID for .novaflow/knowledge/ docs */
  private kbCollectionId: string | null = null;
  /** Collection ID for per-run implementation summaries */
  private memoryCollectionId: string | null = null;

  private constructor(host: string, port: number, prefix: string) {
    this.host = host;
    this.port = port;
    this.prefix = prefix;
  }

  /** Returns a connected instance, or null if ChromaDB is not reachable. */
  static async create(
    host: string,
    port: number,
    prefix: string
  ): Promise<KnowledgeBase | null> {
    try {
      const kb = new KnowledgeBase(host, port, prefix);
      await kb.ping();
      await kb.ensureCollections();
      return kb;
    } catch {
      return null;
    }
  }

  private get apiBase(): string {
    return `http://${this.host}:${this.port}/api/v2/tenants/default_tenant/databases/default_database`;
  }

  private async ping(): Promise<void> {
    const res = await fetch(
      `http://${this.host}:${this.port}/api/v2/heartbeat`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (!res.ok) throw new Error(`ChromaDB ping failed: ${res.status}`);
  }

  private async ensureCollections(): Promise<void> {
    [this.kbCollectionId, this.memoryCollectionId] = await Promise.all([
      this.getOrCreateCollection(`${this.prefix}-knowledge`),
      this.getOrCreateCollection(`${this.prefix}-run-memory`),
    ]);
  }

  private async getOrCreateCollection(name: string): Promise<string> {
    // Try GET first
    const getRes = await fetch(`${this.apiBase}/collections/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (getRes.ok) {
      const data = await getRes.json() as { id: string };
      return data.id;
    }
    // Create
    const createRes = await fetch(`${this.apiBase}/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, metadata: { "hnsw:space": "cosine" } }),
      signal: AbortSignal.timeout(5000),
    });
    if (!createRes.ok) {
      throw new Error(`Failed to create collection "${name}": ${createRes.status}`);
    }
    const data = await createRes.json() as { id: string };
    return data.id;
  }

  // ─── Ingestion ─────────────────────────────────────────────────────────────

  /**
   * Upsert all KB markdown files into the knowledge collection.
   * Each file is chunked (~1 000 chars, 200-char overlap).
   */
  async ingestKbFiles(kbDir: string, filenames: string[]): Promise<void> {
    if (!this.kbCollectionId || filenames.length === 0) return;

    const ids: string[] = [];
    const documents: string[] = [];
    const metadatas: Record<string, string>[] = [];

    for (const filename of filenames) {
      try {
        const content = readFileSync(path.join(kbDir, filename), "utf-8");
        const chunks = chunkText(content, 1000, 200);
        chunks.forEach((chunk, i) => {
          ids.push(`${filename}::${i}`);
          documents.push(chunk);
          metadatas.push({ filename, chunkIndex: String(i) });
        });
      } catch {
        // skip unreadable files
      }
    }

    if (ids.length === 0) return;

    await fetch(`${this.apiBase}/collections/${this.kbCollectionId}/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, documents, metadatas }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => { /* non-fatal */ });
  }

  /**
   * Remove all chunks for a deleted KB file from the knowledge collection.
   */
  async deleteKbFile(filename: string): Promise<void> {
    if (!this.kbCollectionId) return;
    await fetch(`${this.apiBase}/collections/${this.kbCollectionId}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ where: { filename } }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => { /* non-fatal */ });
  }

  // ─── Querying ──────────────────────────────────────────────────────────────

  /**
   * Query the KB knowledge collection and return matching chunks as a string.
   */
  async queryKb(text: string, nResults = 5): Promise<string> {
    if (!this.kbCollectionId) return "";
    return this.queryCollection(this.kbCollectionId, text, nResults);
  }

  /**
   * Query the run-memory collection (past implementation summaries).
   */
  async queryRunMemory(text: string, nResults = 3): Promise<string> {
    if (!this.memoryCollectionId) return "";
    return this.queryCollection(this.memoryCollectionId, text, nResults);
  }

  private async queryCollection(
    collectionId: string,
    text: string,
    nResults: number
  ): Promise<string> {
    try {
      const res = await fetch(`${this.apiBase}/collections/${collectionId}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query_texts: [text], n_results: nResults }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return "";
      const data = await res.json() as ChromaQueryResult;
      const docs = (data.documents?.[0] ?? []).filter((d): d is string => !!d);
      return docs.join("\n\n---\n\n");
    } catch {
      return "";
    }
  }

  // ─── Run memory ────────────────────────────────────────────────────────────

  /**
   * Index a completed run's implementation summary.
   * Called after a successful run so future runs can learn from previous work.
   */
  async indexRunSummary(runId: string, content: string): Promise<void> {
    if (!this.memoryCollectionId) return;
    await fetch(`${this.apiBase}/collections/${this.memoryCollectionId}/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: [`run-${runId}`],
        documents: [content],
        metadatas: [{ runId, indexedAt: new Date().toISOString() }],
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => { /* non-fatal */ });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunkText(text: string, maxChars: number, overlap: number): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const chunk = text.slice(i, i + maxChars);
    if (chunk.trim().length > 0) chunks.push(chunk);
    i += maxChars - overlap;
    if (i >= text.length) break;
  }
  return chunks;
}
