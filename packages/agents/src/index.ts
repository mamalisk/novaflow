// Public API for @novaflow/agents
export { agentEventBus, emitAgentEvent, emitRunStatus } from "./graph/event-bus.js";
export { NovaflowState, type NovaflowStateType } from "./graph/state.js";
export type {
  JiraTicket,
  FigmaDesign,
  BAOutput,
  TestPlanOutput,
  ImplementationOutput,
  DevOpsOutput,
  PlaywrightResult,
  FinalReport,
} from "./graph/state.js";
export { buildGraph, startRun, resumeRun, setCompiledGraph, getCompiledGraph } from "./graph/graph.js";
export { getCheckpointer } from "./graph/checkpointer.js";
export { createChatModel } from "./provider/model-factory.js";

// Initialization helper — call this once at server startup
import { buildGraph, setCompiledGraph, getCompiledGraph } from "./graph/graph.js";
import { createChatModel } from "./provider/model-factory.js";
import type { NovaflowConfig, NovaflowProjectConfig } from "@novaflow/shared-types";

export async function initAgents(
  globalConfig: NovaflowConfig,
  projectConfig: NovaflowProjectConfig
): Promise<void> {
  const llm = await createChatModel(globalConfig);
  const graph = buildGraph(llm, projectConfig);
  setCompiledGraph(graph);
}

// ─── Integration health checks ────────────────────────────────────────────────

export interface IntegrationStatus {
  ok: boolean;
  message: string;
}

export interface IntegrationsCheckResult {
  graphInitialized: boolean;
  ai: IntegrationStatus;
  jira: IntegrationStatus;
  gitlab: IntegrationStatus;
  figma: IntegrationStatus;
}

export async function checkIntegrations(
  globalConfig: NovaflowConfig,
  projectConfig: NovaflowProjectConfig
): Promise<IntegrationsCheckResult> {
  const [ai, jira, gitlab, figma] = await Promise.allSettled([
    checkAI(globalConfig),
    checkJira(projectConfig),
    checkGitLab(projectConfig),
    checkFigma(projectConfig),
  ]);

  let graphInitialized = false;
  try {
    getCompiledGraph();
    graphInitialized = true;
  } catch {
    // not initialized
  }

  return {
    graphInitialized,
    ai: fromSettled(ai),
    jira: fromSettled(jira),
    gitlab: fromSettled(gitlab),
    figma: fromSettled(figma),
  };
}

function fromSettled(result: PromiseSettledResult<IntegrationStatus>): IntegrationStatus {
  if (result.status === "fulfilled") return result.value;
  const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
  return { ok: false, message: msg };
}

async function checkAI(config: NovaflowConfig): Promise<IntegrationStatus> {
  const { provider, apiKey, model } = config.ai;

  try {
    switch (provider) {
      case "anthropic":
        await import("@langchain/anthropic");
        break;
      case "openai":
      case "azure-openai":
        await import("@langchain/openai");
        break;
      case "ollama":
        await import("@langchain/ollama");
        break;
      default:
        return { ok: false, message: `Unknown provider: ${provider as string}` };
    }
  } catch {
    return { ok: false, message: `Provider package not installed for "${provider}"` };
  }

  if (provider !== "ollama" && !apiKey) {
    return { ok: false, message: "API key not configured" };
  }

  return { ok: true, message: `${provider} / ${model}` };
}

async function checkJira(config: NovaflowProjectConfig): Promise<IntegrationStatus> {
  const { baseUrl, email, apiToken } = config.jira;

  if (!baseUrl || !email || !apiToken) {
    return { ok: false, message: "JIRA credentials incomplete" };
  }

  try {
    const creds = Buffer.from(`${email}:${apiToken}`).toString("base64");
    const res = await fetch(`${baseUrl}/rest/api/3/myself`, {
      headers: { Authorization: `Basic ${creds}`, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return { ok: false, message: `Auth failed (${res.status} ${res.statusText})` };
    }

    const data = await res.json() as { displayName?: string; emailAddress?: string };
    return { ok: true, message: data.displayName ?? data.emailAddress ?? "Connected" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Connection error: ${msg}` };
  }
}

async function checkGitLab(config: NovaflowProjectConfig): Promise<IntegrationStatus> {
  const { baseUrl, personalAccessToken } = config.gitlab;

  if (!baseUrl || !personalAccessToken) {
    return { ok: false, message: "GitLab credentials incomplete" };
  }

  try {
    const res = await fetch(`${baseUrl}/api/v4/user`, {
      headers: { "PRIVATE-TOKEN": personalAccessToken },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return { ok: false, message: `Auth failed (${res.status} ${res.statusText})` };
    }

    const data = await res.json() as { name?: string; username?: string };
    return { ok: true, message: data.name ?? data.username ?? "Connected" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Connection error: ${msg}` };
  }
}

async function checkFigma(config: NovaflowProjectConfig): Promise<IntegrationStatus> {
  if (!config.figma?.accessToken) {
    return { ok: true, message: "Not configured (optional)" };
  }

  try {
    const res = await fetch("https://api.figma.com/v1/me", {
      headers: { "X-Figma-Token": config.figma.accessToken },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return { ok: false, message: `Auth failed (${res.status})` };
    }

    const data = await res.json() as { handle?: string; email?: string };
    return { ok: true, message: data.handle ?? data.email ?? "Connected" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Connection error: ${msg}` };
  }
}
