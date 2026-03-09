import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { SqlJsCheckpointer } from "./graph/checkpointer.js";
import { buildGraph, startRun, resumeRun, type CompiledGraph } from "./graph/graph.js";
import { KnowledgeBase } from "./graph/knowledge-base.js";
import { agentEventBus } from "./graph/event-bus.js";
import { createChatModel } from "./provider/model-factory.js";
import { buildConfig, checkIntegrations, checkChromaDB } from "./config.js";
import type { NovaflowEvent } from "./types/index.js";

export interface KbFile {
  name: string;     // filename without .md
  filename: string; // full filename e.g. architecture.md
}

const KB_TEMPLATES: Record<string, string> = {
  architecture: `# Architecture

Describe the overall system architecture here.

## Tech Stack

## Key Patterns

## Directory Structure
`,
  "coding-conventions": `# Coding Conventions

## Naming

## File Organisation

## Testing
`,
  "definition-of-done": `# Definition of Done

- [ ] Code reviewed
- [ ] Tests passing
- [ ] Documentation updated
`,
  "test-strategy": `# Test Strategy

## Unit Tests

## Integration Tests

## E2E Tests (Playwright)
`,
  custom: `# Custom Knowledge

Add your project-specific context here.
`,
};

export interface StatusResult {
  graphInitialized: boolean;
  ai: { ok: boolean; message: string };
  jira: { ok: boolean; message: string };
  gitlab: { ok: boolean; message: string };
  /** ChromaDB is optional — ok:false is neutral, not an error */
  chromadb: { ok: boolean; message: string };
}

function getWorkspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

function getKbDir(): string {
  return path.join(getWorkspaceRoot(), ".novaflow", "knowledge");
}

function ensureKbDir(): void {
  const dir = getKbDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function listKbFiles(): KbFile[] {
  const dir = getKbDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((filename) => ({ name: filename.replace(/\.md$/, ""), filename }));
}

/** Manages the compiled LangGraph graph and bridges events to the webview panel. */
export class NovaflowRunner {
  private graph: CompiledGraph | null = null;
  private kb: KnowledgeBase | null = null;
  private panel: vscode.WebviewPanel | null = null;
  private activeRunId: string | null = null;
  private context: vscode.ExtensionContext;
  private statusCache: StatusResult | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    // Bridge agentEventBus → webview postMessage
    agentEventBus.on("agent:event", ({ runId, event }: { runId: string; event: NovaflowEvent }) => {
      if (runId !== this.activeRunId) return;
      this.panel?.webview.postMessage({ type: "agent:event", event });
    });
  }

  setPanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    // Ensure .novaflow/knowledge/ exists in the workspace
    ensureKbDir();
    // Send initial KB file list
    this.sendKbList();
    // Ingest current KB files into ChromaDB (if available)
    this.ingestKb().catch(() => {});
  }

  clearPanel(): void {
    this.panel = null;
  }

  async initialize(): Promise<void> {
    try {
      const { global: globalConfig, project: projectConfig } = await buildConfig(
        this.context.secrets
      );

      const wasmPath = path.join(this.context.extensionPath, "dist", "sql-wasm.wasm");
      const dbPath = path.join(this.context.globalStorageUri.fsPath, "novaflow.sqlite");

      const [llm, checkpointer, kb] = await Promise.all([
        createChatModel(globalConfig),
        SqlJsCheckpointer.create(dbPath, wasmPath),
        KnowledgeBase.create(
          globalConfig.chromadb.host,
          globalConfig.chromadb.port,
          globalConfig.chromadb.collectionPrefix
        ),
      ]);

      this.kb = kb;
      this.graph = buildGraph(llm, projectConfig, checkpointer, kb);

      // Ingest KB files if ChromaDB is available
      if (kb) {
        this.ingestKb().catch(() => {});
      }

      // Refresh status after successful init
      await this.refreshStatus();
    } catch (err) {
      console.error("[novaflow] Failed to initialize graph:", err);
      this.graph = null;
    }
  }

  async refreshStatus(): Promise<StatusResult> {
    try {
      const { global: globalConfig, project: projectConfig } = await buildConfig(
        this.context.secrets
      );
      const [integrations, chromadb] = await Promise.all([
        checkIntegrations(globalConfig, projectConfig),
        checkChromaDB(globalConfig),
      ]);
      this.statusCache = {
        graphInitialized: this.graph !== null,
        ...integrations,
        chromadb,
      };
    } catch {
      this.statusCache = {
        graphInitialized: false,
        ai: { ok: false, message: "Error" },
        jira: { ok: false, message: "Error" },
        gitlab: { ok: false, message: "Error" },
        chromadb: { ok: false, message: "Error" },
      };
    }
    return this.statusCache;
  }

  getStatus(): StatusResult {
    return this.statusCache ?? {
      graphInitialized: false,
      ai: { ok: false, message: "Checking…" },
      jira: { ok: false, message: "Checking…" },
      gitlab: { ok: false, message: "Checking…" },
      chromadb: { ok: false, message: "Checking…" },
    };
  }

  /** Ingest all current KB files into ChromaDB. No-op if KB unavailable. */
  private async ingestKb(): Promise<void> {
    if (!this.kb) return;
    const files = listKbFiles();
    if (files.length === 0) return;
    await this.kb.ingestKbFiles(getKbDir(), files.map((f) => f.filename));
  }

  async handleMessage(msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      case "run:start": {
        if (!this.graph) {
          this.panel?.webview.postMessage({
            type: "agent:event",
            event: { type: "run:failed", error: "Graph not initialized. Configure API keys first." },
          });
          return;
        }

        const runId = crypto.randomUUID();
        this.activeRunId = runId;

        this.panel?.webview.postMessage({ type: "run:started", runId });

        const workspaceRoot =
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

        // Fire-and-forget — events flow back via agentEventBus
        void startRun(
          this.graph,
          {
            runId,
            jiraTicketId: msg.ticketId as string,
            additionalContext: (msg.additionalContext as string | undefined) ?? undefined,
          },
          workspaceRoot,
          this.kb
        );
        break;
      }

      case "checkpoint:respond": {
        if (!this.graph || !this.activeRunId) return;
        const workspaceRoot =
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

        void resumeRun(
          this.graph,
          this.activeRunId,
          msg.decision as { action: "approved" | "rejected" | "modified" },
          workspaceRoot,
          this.kb
        );
        break;
      }

      case "status:request": {
        const status = await this.refreshStatus();
        this.panel?.webview.postMessage({ type: "status:update", status });
        break;
      }

      case "reinitialize": {
        await this.initialize();
        const status = this.getStatus();
        this.panel?.webview.postMessage({ type: "status:update", status });
        break;
      }

      case "kb:list": {
        this.sendKbList();
        break;
      }

      case "kb:create": {
        ensureKbDir();
        const templateKey = (msg.template as string | undefined) ?? "custom";
        const baseName = (msg.name as string | undefined)?.trim().replace(/[^a-z0-9-]/gi, "-").toLowerCase() || templateKey;
        const filename = `${baseName}.md`;
        const filePath = path.join(getKbDir(), filename);

        if (!fs.existsSync(filePath)) {
          const content = KB_TEMPLATES[templateKey] ?? KB_TEMPLATES.custom;
          fs.writeFileSync(filePath, content, "utf-8");
        }

        // Open the file in the VS Code editor
        await vscode.window.showTextDocument(vscode.Uri.file(filePath));
        this.sendKbList();
        // Re-ingest updated KB into ChromaDB
        this.ingestKb().catch(() => {});
        break;
      }

      case "kb:open": {
        const filename = msg.filename as string;
        const filePath = path.join(getKbDir(), filename);
        if (fs.existsSync(filePath)) {
          await vscode.window.showTextDocument(vscode.Uri.file(filePath));
        }
        break;
      }

      case "kb:delete": {
        const filename = msg.filename as string;
        const filePath = path.join(getKbDir(), filename);
        const answer = await vscode.window.showWarningMessage(
          `Delete knowledge file "${filename}"?`,
          { modal: true },
          "Delete"
        );
        if (answer === "Delete" && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          // Remove from ChromaDB too
          this.kb?.deleteKbFile(filename).catch(() => {});
        }
        this.sendKbList();
        break;
      }
    }
  }

  private sendKbList(): void {
    this.panel?.webview.postMessage({ type: "kb:list", files: listKbFiles() });
  }
}
