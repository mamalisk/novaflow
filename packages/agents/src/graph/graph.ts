import { StateGraph, START, END, interrupt } from "@langchain/langgraph";
import { Command } from "@langchain/langgraph";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { NovaflowState, type NovaflowStateType } from "./state.js";
import { getCheckpointer } from "./checkpointer.js";
import { createFetchJiraNode } from "../nodes/fetch-jira.js";
import { createBusinessAnalystNode } from "../nodes/business-analyst.js";
import { createTestAnalystNode } from "../nodes/test-analyst.js";
import { createDeveloperNode } from "../nodes/developer.js";
import { createDevOpsNode } from "../nodes/devops.js";
import { createPlaywrightRunnerNode } from "../nodes/playwright-runner.js";
import { createReportGeneratorNode } from "../nodes/report-generator.js";
import { emitAgentEvent } from "./event-bus.js";
import type { NovaflowProjectConfig } from "@novaflow/shared-types";

// ─── Checkpoint gate node factory ────────────────────────────────────────────

function makeCheckpointGate(gateName: string, enabled: boolean) {
  return async function checkpointGate(
    state: NovaflowStateType
  ): Promise<Partial<NovaflowStateType>> {
    if (!enabled) {
      // Checkpoint disabled in config — auto-approve
      return { checkpointDecision: "approved" };
    }

    emitAgentEvent(state.runId, {
      type: "checkpoint:required",
      gate: gateName as "post-ba" | "pre-impl" | "pre-commit" | "agent-uncertainty",
      agentId: "orchestrator",
      payload: getCheckpointPayload(state, gateName),
    });

    // interrupt() suspends the graph here.
    // Resumed by resumeRun() passing Command({ resume: decision })
    const decision = interrupt({
      gate: gateName,
      payload: getCheckpointPayload(state, gateName),
      timestamp: new Date().toISOString(),
    }) as { action: "approved" | "rejected" | "modified"; payload?: Record<string, unknown> };

    return {
      checkpointDecision: decision.action,
      checkpointPayload: decision.payload ?? null,
    };
  };
}

function getCheckpointPayload(state: NovaflowStateType, gate: string): unknown {
  switch (gate) {
    case "post-ba":
      return state.baOutput;
    case "pre-impl":
      return { baOutput: state.baOutput, testPlanOutput: state.testPlanOutput };
    case "pre-commit":
      return {
        implementationOutput: state.implementationOutput,
        testResults: state.testResults,
      };
    default:
      return {};
  }
}

// ─── Graph builder ────────────────────────────────────────────────────────────

// Store on global so the same instance is shared across all module instances
// (Next.js webpack bundles, tsx, etc.) that may import this file separately.
declare global {
  // eslint-disable-next-line no-var
  var __novaflowCompiledGraph: ReturnType<typeof buildGraph> | null | undefined;
}
if (global.__novaflowCompiledGraph === undefined) {
  global.__novaflowCompiledGraph = null;
}

export function buildGraph(
  llm: BaseChatModel,
  projectConfig: NovaflowProjectConfig
) {
  const { checkpoints } = projectConfig.permissions;
  const checkpointer = getCheckpointer();

  const graph = new StateGraph(NovaflowState)
    // Nodes
    .addNode("fetchJira", createFetchJiraNode(projectConfig))
    .addNode("businessAnalyst", createBusinessAnalystNode(llm))
    .addNode("baApprovalGate", makeCheckpointGate("post-ba", checkpoints.afterBusinessAnalysis))
    .addNode("testAnalyst", createTestAnalystNode(llm))
    .addNode("implApprovalGate", makeCheckpointGate("pre-impl", checkpoints.beforeImplementation))
    .addNode("developer", createDeveloperNode(llm, projectConfig))
    .addNode("devopsAgent", createDevOpsNode(llm))
    .addNode("playwrightRunner", createPlaywrightRunnerNode())
    .addNode("commitApprovalGate", makeCheckpointGate("pre-commit", checkpoints.beforeCommit))
    .addNode("reportGenerator", createReportGeneratorNode())

    // Edges
    .addEdge(START, "fetchJira")
    .addEdge("fetchJira", "businessAnalyst")
    .addEdge("businessAnalyst", "baApprovalGate")
    .addConditionalEdges("baApprovalGate", (s) => {
      if (s.checkpointDecision === "rejected") return "businessAnalyst"; // retry
      return "testAnalyst";
    })
    .addEdge("testAnalyst", "implApprovalGate")
    .addConditionalEdges("implApprovalGate", (s) => {
      if (s.checkpointDecision === "rejected") return END;
      return "developer";
    })
    .addConditionalEdges("developer", (s) =>
      s.requiresDevOps ? "devopsAgent" : "playwrightRunner"
    )
    .addEdge("devopsAgent", "playwrightRunner")
    .addEdge("playwrightRunner", "commitApprovalGate")
    .addConditionalEdges("commitApprovalGate", (s) =>
      s.checkpointDecision === "rejected" ? END : "reportGenerator"
    )
    .addEdge("reportGenerator", END);

  return graph.compile({ checkpointer });
}

export function setCompiledGraph(graph: ReturnType<typeof buildGraph>): void {
  global.__novaflowCompiledGraph = graph;
}

export function getCompiledGraph(): ReturnType<typeof buildGraph> {
  if (!global.__novaflowCompiledGraph) throw new Error("Graph not initialized. Call initGraph() first.");
  return global.__novaflowCompiledGraph;
}

// ─── Run control ─────────────────────────────────────────────────────────────

export async function startRun(params: {
  runId: string;
  jiraTicketId: string;
  figmaUrl?: string;
  additionalContext?: string;
}): Promise<void> {
  const graph = getCompiledGraph();
  const config = { configurable: { thread_id: params.runId } };

  const stream = await graph.stream(
    {
      runId: params.runId,
      jiraTicketId: params.jiraTicketId,
      figmaUrl: params.figmaUrl,
      additionalContext: params.additionalContext ?? "",
      status: "running",
    },
    { ...config, streamMode: "values" }
  );

  for await (const _chunk of stream) {
    // Events are broadcast via agentEventBus inside each node
  }
}

export async function resumeRun(
  runId: string,
  decision: { action: "approved" | "rejected" | "modified"; payload?: unknown }
): Promise<void> {
  const graph = getCompiledGraph();
  const config = { configurable: { thread_id: runId } };

  const stream = await graph.stream(new Command({ resume: decision }), {
    ...config,
    streamMode: "values",
  });

  for await (const _chunk of stream) {
    // Events continue flowing via agentEventBus
  }
}
