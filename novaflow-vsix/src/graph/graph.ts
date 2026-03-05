import { StateGraph, START, END, interrupt, Command } from "@langchain/langgraph";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { NovaflowState, type NovaflowStateType } from "./state.js";
import { SqlJsCheckpointer } from "./checkpointer.js";
import { createFetchJiraNode } from "../nodes/fetch-jira.js";
import { createBusinessAnalystNode } from "../nodes/business-analyst.js";
import { createTestAnalystNode } from "../nodes/test-analyst.js";
import { createDeveloperNode } from "../nodes/developer.js";
import { createDevOpsNode } from "../nodes/devops.js";
import { createPlaywrightRunnerNode } from "../nodes/playwright-runner.js";
import { createReportGeneratorNode } from "../nodes/report-generator.js";
import { emitAgentEvent } from "./event-bus.js";
import { writeRunReport } from "./run-reporter.js";
import type { NovaflowProjectConfig } from "../types/index.js";

// ─── Checkpoint gate node factory ────────────────────────────────────────────

function makeCheckpointGate(gateName: string, enabled: boolean) {
  return async function checkpointGate(
    state: NovaflowStateType
  ): Promise<Partial<NovaflowStateType>> {
    if (!enabled) return { checkpointDecision: "approved" };

    emitAgentEvent(state.runId, {
      type: "checkpoint:required",
      gate: gateName as "post-ba" | "pre-impl" | "pre-commit" | "agent-uncertainty",
      agentId: "orchestrator",
      payload: getCheckpointPayload(state, gateName),
    });

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
    case "post-ba":   return state.baOutput;
    case "pre-impl":  return { baOutput: state.baOutput, testPlanOutput: state.testPlanOutput };
    case "pre-commit": return { implementationOutput: state.implementationOutput, testResults: state.testResults };
    default:          return {};
  }
}

// ─── Graph builder ────────────────────────────────────────────────────────────

export function buildGraph(
  llm: BaseChatModel,
  projectConfig: NovaflowProjectConfig,
  checkpointer: SqlJsCheckpointer
) {
  const { checkpoints } = projectConfig.permissions;

  const graph = new StateGraph(NovaflowState)
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

    .addEdge(START, "fetchJira")
    .addEdge("fetchJira", "businessAnalyst")
    .addEdge("businessAnalyst", "baApprovalGate")
    .addConditionalEdges("baApprovalGate", (s) =>
      s.checkpointDecision === "rejected" ? "businessAnalyst" : "testAnalyst"
    )
    .addEdge("testAnalyst", "implApprovalGate")
    .addConditionalEdges("implApprovalGate", (s) =>
      s.checkpointDecision === "rejected" ? END : "developer"
    )
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

export type CompiledGraph = ReturnType<typeof buildGraph>;

// ─── Run control ─────────────────────────────────────────────────────────────

export async function startRun(
  graph: CompiledGraph,
  params: { runId: string; jiraTicketId: string; figmaUrl?: string; additionalContext?: string },
  workspaceRoot: string
): Promise<void> {
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

  try {
    for await (const _chunk of stream) {
      // Events are broadcast via agentEventBus inside each node
    }
  } catch (err) {
    emitAgentEvent(params.runId, { type: "run:failed", error: String(err) });
  } finally {
    try {
      const finalState = await graph.getState(config);
      if (finalState.next.length === 0) {
        writeRunReport(finalState.values as NovaflowStateType, workspaceRoot);
      }
    } catch {
      // state read failed — skip report
    }
  }
}

export async function resumeRun(
  graph: CompiledGraph,
  runId: string,
  decision: { action: "approved" | "rejected" | "modified"; payload?: unknown },
  workspaceRoot: string
): Promise<void> {
  const config = { configurable: { thread_id: runId } };

  const stream = await graph.stream(new Command({ resume: decision }), {
    ...config,
    streamMode: "values",
  });

  try {
    for await (const _chunk of stream) {
      // Events continue flowing via agentEventBus
    }
  } catch (err) {
    emitAgentEvent(runId, { type: "run:failed", error: String(err) });
  } finally {
    try {
      const finalState = await graph.getState(config);
      if (finalState.next.length === 0) {
        writeRunReport(finalState.values as NovaflowStateType, workspaceRoot);
      }
    } catch {
      // state read failed — skip report
    }
  }
}
