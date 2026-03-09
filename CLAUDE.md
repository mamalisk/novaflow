# Novaflow — Architecture & Technical Reference

Novaflow is a self-contained VS Code extension. All agent logic, LangGraph orchestration, and UI run inside the extension host — there is no external HTTP server, no pnpm monorepo, and no Socket.io.

---

## Project layout

```
novaflow-vsix/                       # flat npm project (not pnpm, not a monorepo)
├── package.json
├── tsconfig.json
├── esbuild.mjs                      # builds extension + webview bundles
├── .vscode/
│   ├── launch.json                  # F5 → Extension Development Host
│   └── tasks.json                   # npm: build pre-launch task
├── src/
│   ├── extension.ts                 # activate(), registers commands + status bar
│   ├── panel.ts                     # WebviewPanel lifecycle manager
│   ├── runner.ts                    # graph orchestration + postMessage bridge + KB management
│   ├── config.ts                    # reads VS Code settings + SecretStorage → config objects
│   ├── types/                       # inline copies of shared-types (no external dep)
│   │   ├── events.ts                # NovaflowEvent discriminated union
│   │   ├── config.ts                # NovaflowConfig, NovaflowProjectConfig
│   │   ├── run.ts                   # RunStatus, AgentId, GateName, CheckpointDecision
│   │   └── index.ts
│   ├── graph/
│   │   ├── state.ts                 # Annotation.Root typed state
│   │   ├── graph.ts                 # StateGraph, edges, interrupt gates
│   │   ├── event-bus.ts             # EventEmitter singleton (agentEventBus)
│   │   ├── checkpointer.ts          # SqlJsCheckpointer (custom BaseCheckpointSaver)
│   │   └── run-reporter.ts          # writes .novaflow/reports/ in workspace
│   ├── nodes/                       # one file per agent node
│   │   ├── fetch-jira.ts
│   │   ├── business-analyst.ts
│   │   ├── test-analyst.ts
│   │   ├── developer.ts
│   │   ├── devops.ts
│   │   ├── playwright-runner.ts
│   │   └── report-generator.ts
│   ├── provider/
│   │   └── model-factory.ts         # createChatModel(config) → BaseChatModel
│   └── webview/
│       ├── index.tsx                # React entry point
│       ├── App.tsx                  # full UI: compose bar, event log, KB panel, status panel
│       └── vscode.ts                # acquireVsCodeApi() wrapper
└── dist/                            # build output (gitignored)
    ├── extension.js                 # Node CJS bundle (~1.4 MB)
    ├── webview.js                   # browser IIFE bundle (~244 KB)
    └── sql-wasm.wasm                # sql.js WASM (~660 KB, copied from node_modules)
```

---

## Build

```bash
cd novaflow-vsix
npm install
npm run build         # node esbuild.mjs → dist/
npm run watch         # node esbuild.mjs --watch
npm run package       # build + vsce package → novaflow-vsix-*.vsix
```

**esbuild produces two bundles:**

| Input | Output | Platform | Format |
|---|---|---|---|
| `src/extension.ts` | `dist/extension.js` | node | CJS |
| `src/webview/index.tsx` | `dist/webview.js` | browser | IIFE |

`dist/sql-wasm.wasm` is copied from `node_modules/sql.js/dist/sql-wasm.wasm` at build time.

**To launch Extension Development Host:** open `novaflow-vsix/` in VS Code and press `F5`. The build runs automatically via the `preLaunchTask`.

---

## Architecture

### Communication: postMessage

The extension host and webview communicate exclusively via `panel.webview.postMessage()` / `window.addEventListener("message", ...)`. There is no HTTP server or Socket.io.

**Extension → Webview:**

```typescript
{ type: "agent:event"; event: NovaflowEvent }
{ type: "run:started"; runId: string }
{ type: "status:update"; status: StatusResult }
{ type: "kb:list"; files: KbFile[] }
```

**Webview → Extension:**

```typescript
{ type: "run:start"; ticketId: string; additionalContext?: string }
{ type: "checkpoint:respond"; decision: { action: "approved" | "rejected" | "modified" } }
{ type: "status:request" }
{ type: "reinitialize" }
{ type: "kb:list" }
{ type: "kb:create"; template: string; name?: string }
{ type: "kb:open"; filename: string }
{ type: "kb:delete"; filename: string }
```

### Event bus

`agentEventBus` is a module-level `EventEmitter` singleton (`src/graph/event-bus.ts`). Every agent node calls `emitAgentEvent(runId, event)`. `NovaflowRunner` listens on `"agent:event"` and forwards to the webview via `postMessage`.

LangGraph state must be JSON-serializable (persisted by the checkpointer). The EventEmitter singleton bridges the gap — the webview panel reference is not stored in state.

### Configuration

**Non-secret values** are read from VS Code workspace settings (`vscode.workspace.getConfiguration("novaflow")`).

**API keys** are stored in VS Code `SecretStorage` (backed by the OS keychain):
- `novaflow.ai.apiKey`
- `novaflow.jira.apiToken`
- `novaflow.gitlab.token`

`buildConfig(secrets)` in `src/config.ts` merges both sources into `NovaflowConfig` + `NovaflowProjectConfig`.

The **`novaflow.configure`** command (`extension.ts`) opens a quick-pick to store secrets one at a time via `context.secrets.store()`. After storing, it re-calls `runner.initialize()` so the graph reloads with the new credentials.

### Checkpointer: SqlJsCheckpointer

`src/graph/checkpointer.ts` implements a custom `BaseCheckpointSaver` using `sql.js` (pure-JS SQLite WASM — no native binaries, required for VS Code extension bundling).

- **DB path:** `context.globalStorageUri.fsPath/novaflow.sqlite` (VS Code's per-extension storage)
- **WASM path:** `context.extensionPath/dist/sql-wasm.wasm`
- **Schema:** same 3-table layout as LangGraph's `SqliteSaver` (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`)
- **Persistence:** `db.export()` → `fs.writeFileSync()` after every write
- **`TASKS` constant:** not exported from `@langchain/langgraph` main index — hardcoded as `"__pregel_tasks"` in the checkpointer

### Human-in-the-loop

Three checkpoint gate nodes call `interrupt()`:
- `baApprovalGate` — post business analysis
- `implApprovalGate` — pre implementation
- `commitApprovalGate` — pre commit

Each gate emits a `checkpoint:required` event to the webview, which shows a `CheckpointBanner`. The user's response is sent back as `checkpoint:respond`, which calls `resumeRun()` with `graph.stream(new Command({ resume: decision }), config)`.

Each gate is toggled independently via `novaflow.checkpoints.*` settings.

### Knowledge base

KB files are `.md` documents stored in `.novaflow/knowledge/` inside the open workspace.

- `ensureKbDir()` is called on every `setPanel()` — auto-creates the directory on first panel open
- `listKbFiles()` returns `{ name, filename }[]` sorted alphabetically
- `kb:create` creates a file from a pre-defined template and opens it in the VS Code editor via `vscode.window.showTextDocument()`
- `kb:open` opens an existing file in the VS Code editor
- `kb:delete` shows a modal `showWarningMessage` confirmation before `fs.unlinkSync()`

Templates defined in `runner.ts`: `architecture`, `coding-conventions`, `test-strategy`, `definition-of-done`, `custom`.

---

## Agent pipeline

```
START → fetchJira → businessAnalyst → [baApprovalGate]
                                           ↓ approved
                                       testAnalyst → [implApprovalGate]
                                                          ↓ approved
                                                      developer
                                                          ↓ (conditional if requiresDevOps)
                                              devopsAgent ┐
                                                          ↓
                                                  playwrightRunner → [commitApprovalGate]
                                                                          ↓ approved
                                                                      reportGenerator → END
```

Rejected at `baApprovalGate` retries `businessAnalyst`. Rejected at `implApprovalGate` or `commitApprovalGate` goes to END.

### Node pattern

Every node is a factory: `createXxxNode(llm, config?) => async (state) => Partial<NovaflowStateType>`.

1. Emit `agent:started`
2. Emit `agent:thinking` during work
3. Invoke LLM via `ChatPromptTemplate.pipe(llm.withStructuredOutput(zodSchema))`
4. Write files to workspace if needed (developer, devops nodes)
5. Emit `agent:completed` or `agent:error`
6. Return `Partial<NovaflowStateType>`

### Additional context

`additionalContext` is an optional string passed from the webview compose bar. It is carried in graph state and appended to the prompts of `businessAnalyst`, `testAnalyst`, and `developer` nodes, giving the user a way to inject constraints or architectural decisions.

---

## AI provider abstraction

`createChatModel(config)` in `src/provider/model-factory.ts` lazily imports the provider package at runtime:

| `provider` | Package |
|---|---|
| `anthropic` | `@langchain/anthropic` |
| `openai` | `@langchain/openai` |
| `azure-openai` | `@langchain/openai` |
| `ollama` | `@langchain/ollama` |

All nodes receive a `BaseChatModel` — never a concrete provider type.

**Azure AI Foundry:** pass the Azure endpoint as `novaflow.ai.baseUrl`. The Anthropic SDK uses it as `anthropicApiUrl`. Azure expects the subscription key in `x-api-key` (same header Anthropic uses — no special handling needed).

---

## Critical package versions

```json
"@langchain/core": "^1.1.28",
"@langchain/langgraph": "^1.1.5",
"@langchain/anthropic": "^1.3.20",
"@langchain/openai": "^1.0.0",
"@langchain/ollama": "^1.0.0"
```

All LangChain packages must be **v1.x**. The v0.3/v0.2 ecosystem is incompatible with the sql.js checkpointer and `@langchain/langgraph@^1.x`.

**LangGraph API notes:**
- `graph.stream()` returns a `Promise<AsyncIterable>` — must `await` before `for await…of`
- Resume a paused run: `graph.stream(new Command({ resume: decision }), config)`
- `interrupt()` is imported from `@langchain/langgraph`
