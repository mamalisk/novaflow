# Novaflow

An AI-first development tool delivered as a self-contained VS Code extension. Give it a JIRA ticket — it produces a business analysis, test plan, implementation, and GitLab MR, with human approval checkpoints throughout.

---

## Prerequisites

- VS Code 1.85+
- Node.js 20+ (for building from source)
- An AI provider API key (Anthropic, OpenAI, Azure OpenAI, or a local Ollama instance)
- JIRA and GitLab credentials

---

## Installation

### From the VS Code Marketplace

Search for **Novaflow** in the Extensions view (`Ctrl+Shift+X`) and install.

### From source (`.vsix` package)

```bash
git clone <repo>
cd novaflow/novaflow-vsix
npm install
npm run package       # produces novaflow-vsix-*.vsix
```

Install the `.vsix`:

```bash
code --install-extension novaflow-vsix-*.vsix
```

Or via the Extensions view: **⋯ → Install from VSIX…**

---

## First-time setup

### 1. Configure API keys

Open the Command Palette (`Ctrl+Shift+P`) → **Novaflow: Configure API Keys**

This stores secrets using VS Code's built-in `SecretStorage` (OS keychain-backed). You will be prompted for:

- **AI API Key** — Anthropic, OpenAI, or Azure subscription key
- **JIRA API Token** — Atlassian API token
- **GitLab Access Token** — personal access token

### 2. Configure settings

Open VS Code Settings (`Ctrl+,`) and search for `novaflow`. Key settings:

| Setting | Default | Description |
|---|---|---|
| `novaflow.ai.provider` | `anthropic` | `anthropic` \| `openai` \| `azure-openai` \| `ollama` |
| `novaflow.ai.model` | `claude-opus-4-6` | Model name / Azure deployment name |
| `novaflow.ai.baseUrl` | _(empty)_ | Azure AI Foundry endpoint or Ollama URL |
| `novaflow.ai.temperature` | `0.2` | LLM temperature |
| `novaflow.jira.baseUrl` | _(empty)_ | e.g. `https://myorg.atlassian.net` |
| `novaflow.jira.email` | _(empty)_ | JIRA account email |
| `novaflow.jira.project` | _(empty)_ | Default JIRA project key (e.g. `PROJ`) |
| `novaflow.gitlab.baseUrl` | _(empty)_ | GitLab base URL |
| `novaflow.gitlab.projectId` | _(empty)_ | GitLab project ID |
| `novaflow.gitlab.defaultBranch` | `main` | Base branch for MRs |
| `novaflow.checkpoints.afterBA` | `true` | Pause for approval after business analysis |
| `novaflow.checkpoints.beforeImpl` | `true` | Pause for approval before implementation |
| `novaflow.checkpoints.beforeCommit` | `true` | Pause for approval before committing |

### 3. Open the panel

Command Palette → **Novaflow: Open**

The status bar shows a **$(robot) Novaflow** item as a quick shortcut.

---

## Running a ticket

1. Open the Novaflow panel
2. Enter a JIRA ticket ID (e.g. `PROJ-123`) in the compose bar
3. Optionally add implementation notes (constraints, architecture decisions, context)
4. Click **Start Run**
5. Watch the live event log as agents work through the pipeline

---

## Approval checkpoints

When a checkpoint is enabled, the workflow pauses and a banner appears showing the agent's output. You can:

- **Approve** — continue to the next stage
- **Reject** — the agent retries (BA stage) or the run is cancelled
- **Modify** — approve with changes

Agents can also pause on their own when uncertain, asking a specific question in the same checkpoint UI.

Checkpoints are toggled via VS Code settings (`novaflow.checkpoints.*`).

---

## Knowledge base

The extension auto-creates `.novaflow/knowledge/` in your workspace the first time the panel opens. Place Markdown documents here to give agents awareness of your project's conventions, architecture, and standards.

### Managing knowledge files

The **Knowledge Base** section in the panel sidebar lets you:

- **View** all `.md` files in `.novaflow/knowledge/`
- **Create** new files from pre-built templates:
  - Architecture
  - Coding Conventions
  - Test Strategy
  - Definition of Done
  - Custom
- **Open** any file in the VS Code editor
- **Delete** a file (with confirmation)

### Typical structure

```
.novaflow/knowledge/
├── architecture.md
├── coding-conventions.md
├── test-strategy.md
├── definition-of-done.md
└── custom.md
```

---

## Azure AI Foundry (Anthropic via Azure)

If your organisation routes Claude through Azure AI Foundry:

1. Set `novaflow.ai.provider` to `anthropic`
2. Set `novaflow.ai.model` to your Azure deployment name
3. Set `novaflow.ai.baseUrl` to your Azure endpoint (e.g. `https://xxx.eastus.models.ai.azure.com`)
4. Run **Novaflow: Configure API Keys** → **AI API Key** → enter your Azure subscription key

---

## Run state and history

Run state is persisted in a local SQLite database (`novaflow.sqlite`) stored in VS Code's per-extension global storage directory. Runs survive VS Code restarts and can be resumed after a crash.

---

## Building from source

```bash
cd novaflow-vsix
npm install
npm run build        # produces dist/extension.js + dist/webview.js + dist/sql-wasm.wasm
```

To launch an Extension Development Host:

1. Open the `novaflow-vsix/` folder in VS Code
2. Press `F5`

The build runs automatically before the Extension Development Host starts.

To package a `.vsix`:

```bash
npm run package
```
