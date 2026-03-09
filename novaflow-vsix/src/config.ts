import * as vscode from "vscode";
import type { NovaflowConfig, NovaflowProjectConfig } from "./types/index.js";

/**
 * Builds the NovaflowConfig from VS Code workspace settings + SecretStorage.
 * Non-secret values come from workspace configuration; API keys from SecretStorage.
 */
export async function buildConfig(
  secrets: vscode.SecretStorage
): Promise<{ global: NovaflowConfig; project: NovaflowProjectConfig }> {
  const cfg = vscode.workspace.getConfiguration("novaflow");

  const aiApiKey = (await secrets.get("novaflow.ai.apiKey")) ?? "";
  const jiraToken = (await secrets.get("novaflow.jira.apiToken")) ?? "";
  const gitlabToken = (await secrets.get("novaflow.gitlab.token")) ?? "";

  const globalConfig: NovaflowConfig = {
    version: "1",
    ai: {
      provider: cfg.get<NovaflowConfig["ai"]["provider"]>("ai.provider", "anthropic"),
      model: cfg.get<string>("ai.model", "claude-opus-4-6"),
      apiKey: aiApiKey,
      baseUrl: cfg.get<string>("ai.baseUrl") || undefined,
      temperature: cfg.get<number>("ai.temperature", 0.2),
    },
    chromadb: {
      host: cfg.get<string>("chromadb.host", "localhost"),
      port: cfg.get<number>("chromadb.port", 8000),
      collectionPrefix: "novaflow",
    },
  };

  const projectConfig: NovaflowProjectConfig = {
    version: "1",
    projectName: vscode.workspace.name ?? "workspace",
    jira: {
      baseUrl: cfg.get<string>("jira.baseUrl", ""),
      email: cfg.get<string>("jira.email", ""),
      apiToken: jiraToken,
      defaultProject: cfg.get<string>("jira.project", ""),
    },
    gitlab: {
      baseUrl: cfg.get<string>("gitlab.baseUrl", ""),
      personalAccessToken: gitlabToken,
      projectId: cfg.get<string>("gitlab.projectId", ""),
      defaultBranch: cfg.get<string>("gitlab.defaultBranch", "main"),
      branchPrefix: "novaflow/",
      commitMessageTemplate: "{ticketId}: {summary}",
    },
    permissions: {
      checkpoints: {
        afterBusinessAnalysis: cfg.get<boolean>("checkpoints.afterBA", true),
        beforeImplementation: cfg.get<boolean>("checkpoints.beforeImpl", true),
        beforeCommit: cfg.get<boolean>("checkpoints.beforeCommit", true),
      },
      allowAgentUncertaintyPause: true,
    },
    knowledgeBase: {
      documents: [],
      autoIngestOnStart: false,
    },
  };

  return { global: globalConfig, project: projectConfig };
}

/** Check ChromaDB connectivity. Never throws — returns ok:false when unavailable. */
export async function checkChromaDB(
  config: NovaflowConfig
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(
      `http://${config.chromadb.host}:${config.chromadb.port}/api/v2/heartbeat`,
      { signal: AbortSignal.timeout(3000) }
    );
    return res.ok
      ? { ok: true, message: `${config.chromadb.host}:${config.chromadb.port}` }
      : { ok: false, message: "unreachable" };
  } catch {
    return { ok: false, message: "not running" };
  }
}

/** Check which integrations are healthy. */
export async function checkIntegrations(
  config: NovaflowConfig,
  projectConfig: NovaflowProjectConfig
): Promise<{
  ai: { ok: boolean; message: string };
  jira: { ok: boolean; message: string };
  gitlab: { ok: boolean; message: string };
}> {
  const [ai, jira, gitlab] = await Promise.all([
    checkAI(config),
    checkJira(projectConfig),
    checkGitLab(projectConfig),
  ]);
  return { ai, jira, gitlab };
}

async function checkAI(config: NovaflowConfig): Promise<{ ok: boolean; message: string }> {
  if (!config.ai.apiKey) return { ok: false, message: "API key not set" };
  try {
    // Just verify the package is importable and key is non-empty
    const provider = config.ai.provider;
    if (provider === "anthropic") await import("@langchain/anthropic");
    else if (provider === "openai" || provider === "azure-openai") await import("@langchain/openai");
    else if (provider === "ollama") await import("@langchain/ollama");
    return { ok: true, message: `${config.ai.provider} / ${config.ai.model}` };
  } catch {
    return { ok: false, message: "Provider package not available" };
  }
}

async function checkJira(
  config: NovaflowProjectConfig
): Promise<{ ok: boolean; message: string }> {
  if (!config.jira.baseUrl || !config.jira.apiToken) {
    return { ok: false, message: "Not configured" };
  }
  try {
    const credentials = Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString("base64");
    const res = await fetch(`${config.jira.baseUrl}/rest/api/3/myself`, {
      headers: { Authorization: `Basic ${credentials}`, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json() as { displayName?: string };
      return { ok: true, message: data.displayName ?? "connected" };
    }
    return { ok: false, message: `HTTP ${res.status}` };
  } catch {
    return { ok: false, message: "Unreachable" };
  }
}

async function checkGitLab(
  config: NovaflowProjectConfig
): Promise<{ ok: boolean; message: string }> {
  if (!config.gitlab.baseUrl || !config.gitlab.personalAccessToken) {
    return { ok: false, message: "Not configured" };
  }
  try {
    const res = await fetch(`${config.gitlab.baseUrl}/api/v4/user`, {
      headers: { "PRIVATE-TOKEN": config.gitlab.personalAccessToken },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json() as { username?: string };
      return { ok: true, message: data.username ?? "connected" };
    }
    return { ok: false, message: `HTTP ${res.status}` };
  } catch {
    return { ok: false, message: "Unreachable" };
  }
}
