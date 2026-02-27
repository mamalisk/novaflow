# Novaflow — Architecture & Technical Reference

## Monorepo layout

```
novaflow/
├── apps/
│   ├── server/              @novaflow/server    — Next.js 15 + custom server + React UI
│   └── vscode-extension/    novaflow-vscode     — VS Code companion extension
├── packages/
│   ├── agents/              @novaflow/agents    — LangGraph orchestration, all agent nodes
│   ├── cli/                 @novaflow/cli       — npx entry point
│   └── shared-types/        @novaflow/shared-types — zero-dep TypeScript interfaces
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

**Tooling:** pnpm 9 workspaces + Turborepo 2. All packages are `"type": "module"` (ESM) except the VS Code extension (CommonJS, bundled by esbuild).

Build commands:
```bash
pnpm install          # install all workspaces
pnpm build            # build all packages in dependency order (turbo)
pnpm typecheck        # typecheck all packages
pnpm --filter <name> build  # build a single package
```

---

## Package dependency graph

```
shared-types
    └── agents
    └── cli
    └── server
            └── agents
```

`shared-types` has no runtime dependencies. `agents` depends only on `shared-types` and LangChain. `server` depends on both `shared-types` and `agents`. `cli` depends on `shared-types` only.

---

## packages/shared-types

All cross-package TypeScript interfaces live here. Zero runtime dependencies.

**Critical files:**
- `src/events.ts` — `NovaflowEvent` discriminated union; typed Socket.io event maps (`ServerToClientEvents`, `ClientToServerEvents`)
- `src/config.ts` — `NovaflowConfig` (global) and `NovaflowProjectConfig` (per-project); `defaultNovaflowConfig()` and `defaultProjectConfig()` factories
- `src/run.ts` — `RunStatus`, `AgentId`, `GateName`, `CheckpointDecision`

`tsconfig.json` uses `"composite": true` — required for TypeScript project references from other packages.

---

## packages/agents

The LangGraph orchestration core. No HTTP server, no UI — pure agent logic.

### State (`src/graph/state.ts`)

The entire run's data is held in `NovaflowState`, a typed `Annotation.Root`. Key design decisions per channel:

| Channel | Reducer | Purpose |
|---|---|---|
| `runId`, `jiraTicketId`, `figmaUrl` | overwrite | Immutable run context |
| `baOutput`, `testPlanOutput`, `implementationOutput`, etc. | overwrite | Agent outputs (one per agent) |
| `messages` | `messagesStateReducer` (append + dedupe by id) | LangChain message history |
| `events` | append | Event log for WebSocket streaming |
| `pendingCheckpoint`, `checkpointDecision`, `checkpointPayload` | overwrite | Human-in-the-loop state |
| `requiresDevOps`, `allTestsPassed` | overwrite | Conditional routing flags |

State must remain JSON-serializable — it is persisted by SqliteSaver on every node transition.

### Graph (`src/graph/graph.ts`)

Built with `StateGraph` from `@langchain/langgraph`. Full node and edge wiring:

```
START → fetchJira → businessAnalyst → [baApprovalGate]
                                           ↓ approved
                                       testAnalyst → [implApprovalGate]
                                                          ↓ approved
                                                      developer
                                                          ↓ (conditional)
                                              devopsAgent → playwrightRunner
                                              playwrightRunner → [commitApprovalGate]
                                                                      ↓ approved
                                                                  reportGenerator → END
```

Rejected checkpoints at `baApprovalGate` retry the BA node. Rejected at `implApprovalGate` or `commitApprovalGate` go to END.

**`buildGraph(llm, projectConfig)`** returns a compiled graph. Call `setCompiledGraph()` once at server startup. `getCompiledGraph()` is used by the API routes.

**`startRun(params)`** fires `graph.stream(initialState, config)` asynchronously. Note: `graph.stream()` in LangGraph v1 returns a `Promise<AsyncIterable>` — it must be `await`-ed before iterating.

**`resumeRun(runId, decision)`** fires `graph.stream(new Command({ resume: decision }), config)` to resume from an `interrupt()`.

### Human-in-the-loop (`interrupt()`)

Three configured checkpoint gate nodes wrap `interrupt()`:
- `baApprovalGate` — post business analysis
- `implApprovalGate` — pre implementation
- `commitApprovalGate` — pre commit

Each gate node emits a `checkpoint:required` event to the UI before calling `interrupt()`. The graph suspends and its state is persisted by SqliteSaver. When the user approves or rejects via the UI, the `/api/checkpoint` route calls `resumeRun()` with a `Command({ resume: decision })`.

Ad-hoc uncertainty: the `developerNode` calls `interrupt()` directly when its confidence score falls below 0.7 and `allowAgentUncertaintyPause` is enabled.

### Event bus (`src/graph/event-bus.ts`)

A module-level `EventEmitter` singleton (`agentEventBus`). Every agent node calls `emitAgentEvent(runId, event)` to broadcast progress.

**Why not use LangGraph state for events?** State is persisted by SqliteSaver — it must be JSON-serializable. The Socket.io `io` object is not serializable. The EventEmitter singleton decouples the two: agents emit into it, `socket-server.ts` in the Next.js app listens and forwards to Socket.io.

Events emitted: `"agent:event"` `{ runId, event }` and `"run:status"` `{ runId, status }`. Inbound from socket: `"checkpoint:respond"` `{ runId, decision }`.

### Checkpointer (`src/graph/checkpointer.ts`)

`SqliteSaver.fromConnString("~/.novaflow/.novaflow-sqlite")` — a file-backed SQLite database that persists all run state. This means:
- Runs survive server restarts
- The graph can be resumed after a crash
- Run history is queryable

`MemorySaver` is intentionally not used — it would lose all state on server restart.

### AI provider abstraction (`src/provider/model-factory.ts`)

`createChatModel(config): Promise<BaseChatModel>` lazy-imports the provider package at runtime using dynamic `import()`. This avoids bundling all provider SDKs when only one is needed.

Provider packages are declared as optional `peerDependencies`. The `init` wizard is responsible for installing the chosen provider's package.

All agent nodes receive a `BaseChatModel` and never reference a specific provider. Structured outputs use `llm.withStructuredOutput(zodSchema)` — no raw text parsing.

### Node pattern

Every node is a factory function: `createXxxNode(llm, config?) => async (state) => Partial<state>`.

Node responsibilities:
1. Emit `agent:started`
2. Emit `agent:thinking` messages during work
3. Invoke LLM via `ChatPromptTemplate.pipe(llm.withStructuredOutput(schema))`
4. Write outputs to filesystem if needed (developer, devops nodes)
5. Emit `agent:completed` or `agent:error`
6. Return `Partial<NovaflowStateType>`

### LangChain version constraint

**All LangChain packages must be v1.x.** `@langchain/langgraph-checkpoint-sqlite@^1.0` requires `@langchain/core@^1.x` and `@langchain/langgraph@^1.x`. The v0.3/v0.2 ecosystem is incompatible with the current checkpoint package.

```json
"@langchain/core": "^1.1.28",
"@langchain/langgraph": "^1.1.5",
"@langchain/langgraph-checkpoint-sqlite": "^1.0.1"
```

---

## apps/server

### Custom server entry (`server.ts`)

Next.js App Router does not expose the raw `http.Server` to route handlers. A custom server entry (`server.ts`) starts Next.js programmatically with `next({ dev })` and attaches Socket.io to the same `http.Server`. Both share a single port.

The custom server also reads config files and calls `initAgents(globalConfig, projectConfig)` at startup to build and register the compiled LangGraph graph. `initAgents()` is wrapped in try/catch — if it fails (e.g. AI provider package not installed), the server still starts so the UI and `/api/status` remain reachable.

The loaded config is stored on `global.__novaflowLoadedConfig` so the `/api/status` route can access it without re-reading files. The compiled graph is stored on `global.__novaflowCompiledGraph` (see event-bus global singleton pattern below).

`next.config.ts` does **not** use `output: "standalone"` — standalone mode is incompatible with custom servers and causes symlink failures on Windows with pnpm.

Start: `node --loader ts-node/esm server.ts` (both dev and production for now).

### Socket.io (`src/lib/socket-server.ts`)

`initSocketServer(io)` does two things:
1. Registers Socket.io connection handlers — clients join a run's room via `run:subscribe`, respond to checkpoints via `checkpoint:respond`
2. Bridges the `agentEventBus` EventEmitter to Socket.io: `agentEventBus.on("agent:event")` → `io.to(runId).emit("agent:event")`

The typed Socket.io interface uses the `ServerToClientEvents` / `ClientToServerEvents` types from `@novaflow/shared-types`.

### API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/run` | POST | Starts a run: calls `startRun()` fire-and-forget, returns `{ runId }`. Returns 503 if graph not initialized. |
| `/api/checkpoint` | POST | Resumes a paused run: calls `resumeRun(runId, decision)` |
| `/api/health` | GET | Health check for VS Code extension polling |
| `/api/status` | GET | Returns per-integration connection status (`graphInitialized`, `ai`, `jira`, `gitlab`, `figma`) |

Both `startRun` and `resumeRun` are invoked with `void` — the caller does not await them. Events flow back to the client via Socket.io.

`/api/status` reads `global.__novaflowLoadedConfig` (set by `server.ts` at startup) and calls `checkIntegrations()` from `@novaflow/agents`. Each integration is tested with a live HTTP call (JIRA `/rest/api/3/myself`, GitLab `/api/v4/user`, Figma `/v1/me`). The AI check verifies the provider package is installed and the API key is non-empty. Results are `{ ok: boolean, message: string }` per integration.

### React UI (`src/app/page.tsx`)

A single-page client component. State: ticket ID input, run ID, event log, active checkpoint. The Socket.io client connects on mount and joins the run's room after `POST /api/run` returns.

Checkpoint approval/rejection posts to `/api/checkpoint` directly (HTTP, not Socket.io) to ensure reliable delivery.

---

## apps/vscode-extension

A thin companion extension. Its only job: open a `WebviewPanel` that embeds the Novaflow server URL.

### Key settings on `WebviewPanel`

- `retainContextWhenHidden: true` — prevents the Socket.io connection and React state from being destroyed when the user switches tabs. Without this, every tab switch breaks the live event log.
- `portMapping: [{ extensionHostPort: PORT, webviewPort: PORT }]` — maps the localhost port into the webview's sandboxed network context.
- CSP `frame-src http://localhost:PORT` — explicitly allows the iframe to load from localhost.

### Server readiness

The webview HTML polls `/api/health` every 2 seconds (up to 30 attempts) before showing the iframe. This handles the race between opening the panel and the server finishing its boot.

### Commands registered

| Command | Action |
|---|---|
| `novaflow.openPanel` | Opens or reveals the WebviewPanel |
| `novaflow.startServer` | Creates a terminal, runs `npx novaflow start`, then opens the panel after 3s |

---

## packages/cli

Entry point: `src/index.ts` — Commander.js with three commands.

### `novaflow init`

Interactive wizard using `@inquirer/prompts` (the modern modular replacement for inquirer). Writes:
- `~/.novaflow/config.json` — global config (AI, server, ChromaDB)
- `.novaflow/project.json` — project config (JIRA, GitLab, Figma, permissions)
- `.novaflow/knowledge/` — empty directory, ready for project documents

### `novaflow start`

Spawns the `@novaflow/server` process via `execa`, passing `NOVAFLOW_PORT` and `NOVAFLOW_HOST` as environment variables.

### `novaflow run`

Fire-and-forget HTTP `POST /api/run` to a running server. Returns a run ID. Intended for CI or headless automation.

---

## Configuration architecture

Two-level config:

**Global** (`~/.novaflow/config.json`) — shared across all projects on this machine. Holds AI provider credentials and server settings. Sensitive values should eventually be stored in the OS keychain via `keytar`; the config would then hold `"__keychain__"` as a placeholder.

**Project** (`.novaflow/project.json`) — committed to the project repo (without tokens). Holds integration URLs, checkpoint toggles, and knowledge base document registry.

**Knowledge base** (`.novaflow/knowledge/*.md`) — Markdown documents ingested into ChromaDB at startup. Each document is chunked (1000 tokens, 200 overlap), embedded, and stored in a named collection. Agents query this before each LLM invocation to retrieve relevant project context.

---

## Agent pipeline — detailed flow

```
1. fetchJira
   - Fetches ticket from JIRA REST API v3
   - Parses Atlassian Document Format (ADF) description to plain text
   - Extracts acceptance criteria heuristically (lines after "Acceptance Criteria" heading)
   - Sets state.jiraTicket

2. businessAnalyst
   - Prompt: ticket summary, description, AC, Figma URL, KB context
   - withStructuredOutput(BAOutputSchema): summary, AC, affectedComponents, risks,
     requiresDevOps, figmaReferences, clarifications, confidence
   - Sets state.baOutput, state.requiresDevOps

3. [baApprovalGate]
   - interrupt() suspends graph; emits checkpoint:required to UI
   - Resumed by /api/checkpoint with { action: "approved" | "rejected" }
   - Rejected → retry businessAnalyst

4. testAnalyst
   - Prompt: BA output (summary, AC, components, risks)
   - withStructuredOutput(TestPlanSchema): automatedTests[], manualTests[],
     automationRecommendations[]
   - Sets state.testPlanOutput

5. [implApprovalGate]
   - Same interrupt pattern; rejected → END

6. developer
   - Prompt: BA summary, AC, affected components, automated test specs
   - withStructuredOutput(ImplementationSchema): changes[], summary, confidence, uncertainties
   - If confidence < 0.7 AND allowAgentUncertaintyPause: calls interrupt() ad-hoc
   - Writes changed files to disk (mkdirSync + writeFileSync)
   - Emits file:changed events with simple line-diff for each file
   - Sets state.implementationOutput (includes branchName)

7. devopsAgent (conditional — only if state.requiresDevOps)
   - Prompt: implementation summary + changed files
   - Writes CI/CD YAML changes to disk
   - Sets state.devopsOutput

8. playwrightRunner
   - Shells out: execSync("npx playwright test --reporter=json")
   - Parses JSON output for pass/fail counts and per-test results
   - Emits test:result events
   - Sets state.testResults, state.allTestsPassed

9. [commitApprovalGate]
   - Shows implementation changes and test results; rejected → END

10. reportGenerator
    - Assembles FinalReport from all agent outputs
    - Emits run:completed with reportUrl
    - Sets state.finalReport, state.status = "completed"
```

---

## What is not yet implemented (Phase 2+)

- **ChromaDB knowledge base** — `KnowledgeBase` class exists as a sketch; ingestion and query are not wired into agent prompts yet
- **GitLab integration** — `tools/gitlab.ts` stub; branch creation, file commit, and MR opening not implemented
- **Figma fetching** — `figmaDesigns` in state is always `[]`; Figma REST API calls not yet added to `fetchJira` node
- **JIRA comment** — posting MR link back to JIRA ticket not implemented
- **API key keychain** — `keytar` is installed but not yet used; API keys are stored in plaintext in config JSON
- **Report UI** — `/report/[runId]` route not yet built; `reportUrl` points to a 404
- **IntelliJ plugin** — deferred (requires Kotlin + JCEF)
