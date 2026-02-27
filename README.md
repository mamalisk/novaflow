# Novaflow

An AI-first development tool. Give it a JIRA ticket — it produces a business analysis, test plan, implementation, and GitLab MR, with human approval checkpoints throughout.

---

## Prerequisites

- Node.js 20+
- pnpm 9+ (`npm install -g pnpm`)
- A running [ChromaDB](https://docs.trychroma.com/getting-started) instance (default: `localhost:8000`)
- An AI provider API key (Anthropic, OpenAI, Azure OpenAI, or a local Ollama instance)

---

## Installation

> **Running locally from source?** Build the CLI first, then use `pnpm novaflow` instead of `npx novaflow` throughout this guide:
> ```bash
> pnpm --filter @novaflow/cli build
> pnpm novaflow init
> ```

Once published to npm, use `npx` directly:

```bash
npx novaflow init
```

This runs the interactive setup wizard. You will be asked for:

- **AI provider** — Anthropic, OpenAI, Azure OpenAI, or Ollama
- **Model name** — e.g. `claude-opus-4-6`, `gpt-4o`
- **API key** for your chosen provider
- **JIRA** — base URL, email, and API token
- **GitLab** — base URL, personal access token, project ID, default branch
- **Figma** — access token (optional)
- **Server port** — default `3847`
- **ChromaDB** host and port
- **Approval checkpoints** — whether to pause after BA, before implementation, and before commit

Two config files are created:

| File | Purpose |
|---|---|
| `~/.novaflow/config.json` | Global settings (AI provider, server port, ChromaDB) |
| `.novaflow/project.json` | Project-specific settings (JIRA, GitLab, Figma, checkpoints) |

A `.novaflow/knowledge/` directory is also created — drop project documents in here (see [Knowledge Base](#knowledge-base)).

---

## Starting the server

```bash
npx novaflow start
```

The server starts at `http://localhost:3847` (or whichever port you configured). Open it in your browser to use the UI.

---

## VS Code integration

Install the **Novaflow** VS Code extension. Once installed:

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **Novaflow: Open**

This opens the Novaflow UI inside VS Code as a side panel — no browser needed. If the server is not yet running, use **Novaflow: Start Server** from the Command Palette instead; it opens a terminal and starts the server automatically.

The status bar shows a **Novaflow** item in the bottom-right corner as a quick shortcut.

---

## Running a ticket

### From the UI

1. Open the Novaflow panel (browser or VS Code)
2. Enter a JIRA ticket ID (e.g. `PROJ-123`) in the sidebar
3. Click **Start Run**
4. Watch the live event log as agents work through the pipeline

### From the CLI (headless)

```bash
npx novaflow run --ticket PROJ-123
npx novaflow run --ticket PROJ-123 --figma https://figma.com/file/...
```

The server must already be running. The CLI prints the run ID and a link to the UI.

---

## Approval checkpoints

When a checkpoint is enabled, the workflow pauses and a banner appears in the UI showing the agent's output. You can:

- **Approve** — continue to the next stage
- **Reject** — the agent retries (BA stage) or the run is cancelled

Agents can also pause on their own when uncertain, showing their specific question in the same checkpoint UI.

Checkpoints are configured per-project in `.novaflow/project.json` under `permissions.checkpoints`.

---

## Knowledge base

Place Markdown documents in `.novaflow/knowledge/` to give agents awareness of your project's conventions, architecture, and standards.

Typical documents:

```
.novaflow/knowledge/
├── architecture.md
├── coding-conventions.md
├── test-strategy.md
├── definition-of-ready.md
├── definition-of-done.md
├── git-strategy.md
├── nfr.md
└── component-library.md
```

Register each document in `.novaflow/project.json` under `knowledgeBase.documents`. With `autoIngestOnStart: true`, they are loaded into ChromaDB each time the server starts.

---

## Configuration reference

### `~/.novaflow/config.json`

```jsonc
{
  "version": "1",
  "ai": {
    "provider": "anthropic",       // "anthropic" | "openai" | "azure-openai" | "ollama"
    "model": "claude-opus-4-6",
    "apiKey": "sk-ant-...",
    "baseUrl": "",                 // required for azure-openai and ollama
    "temperature": 0.2
  },
  "server": {
    "port": 3847,
    "host": "localhost"
  },
  "chromadb": {
    "host": "localhost",
    "port": 8000,
    "collectionPrefix": "novaflow"
  }
}
```

### `.novaflow/project.json`

```jsonc
{
  "version": "1",
  "projectName": "my-project",
  "jira": {
    "baseUrl": "https://mycompany.atlassian.net",
    "email": "dev@mycompany.com",
    "apiToken": "...",
    "defaultProject": "PROJ"
  },
  "gitlab": {
    "baseUrl": "https://gitlab.com",
    "personalAccessToken": "...",
    "projectId": "123",
    "defaultBranch": "main",
    "branchPrefix": "novaflow/",
    "commitMessageTemplate": "{ticketId}: {summary}"
  },
  "figma": {
    "accessToken": "..."
  },
  "permissions": {
    "checkpoints": {
      "afterBusinessAnalysis": true,
      "beforeImplementation": true,
      "beforeCommit": true
    },
    "allowAgentUncertaintyPause": true
  },
  "knowledgeBase": {
    "autoIngestOnStart": true,
    "documents": [
      {
        "id": "arch",
        "path": "architecture.md",
        "type": "architecture",
        "description": "System architecture overview"
      }
    ]
  }
}
```

---

## Building from source

```bash
git clone <repo>
cd novaflow
pnpm install
pnpm build
```

Then use `pnpm novaflow <command>` in place of `npx novaflow <command>`:

```bash
pnpm novaflow init
pnpm novaflow start
pnpm novaflow run --ticket PROJ-123
```

To run the server in development mode (with watch):

```bash
pnpm --filter @novaflow/server dev
```

To build the VS Code extension:

```bash
pnpm --filter novaflow-vscode build
```
