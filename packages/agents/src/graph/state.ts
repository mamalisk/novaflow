import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { NovaflowEvent, RunStatus } from "@novaflow/shared-types";

// ─── Agent output types ────────────────────────────────────────────────────────

export interface JiraTicket {
  id: string;
  summary: string;
  description: string;
  acceptanceCriteria: string[];
  priority: string;
  labels: string[];
  components: string[];
}

export interface FigmaDesign {
  nodeId: string;
  name: string;
  imageUrl?: string;
  description?: string;
}

export interface BAOutput {
  summary: string;
  acceptanceCriteria: string[];
  affectedComponents: string[];
  risks: string[];
  requiresDevOps: boolean;
  figmaReferences: Array<{ nodeId: string; description: string }>;
  clarifications: string[];
  confidence: number; // 0-1
}

export interface TestPlanOutput {
  automatedTests: Array<{ name: string; type: "unit" | "integration" | "e2e"; description: string }>;
  manualTests: Array<{ name: string; steps: string[]; expectedResult: string }>;
  automationRecommendations: string[];
}

export interface FileChange {
  path: string;
  action: "create" | "modify" | "delete";
  content?: string;
  diff?: string;
}

export interface ImplementationOutput {
  changes: FileChange[];
  summary: string;
  branchName: string;
}

export interface DevOpsOutput {
  pipelineChanges: FileChange[];
  summary: string;
}

export interface PlaywrightResult {
  passed: number;
  failed: number;
  skipped: number;
  results: Array<{ name: string; passed: boolean; error?: string; duration: number }>;
}

export interface FinalReport {
  runId: string;
  jiraTicketId: string;
  completedAt: string;
  agentSummaries: Record<string, string>;
  testResults?: PlaywrightResult;
  mrUrl?: string;
  manualTestReport?: TestPlanOutput["manualTests"];
}

export interface HumanCheckpoint {
  gate: string;
  agentId: string;
  payload: unknown;
  timestamp: string;
}

// ─── LangGraph State ──────────────────────────────────────────────────────────

export const NovaflowState = Annotation.Root({
  // Immutable run context
  runId: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),
  jiraTicketId: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),
  figmaUrl: Annotation<string | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),
  additionalContext: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),

  // Fetched data
  jiraTicket: Annotation<JiraTicket | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  figmaDesigns: Annotation<FigmaDesign[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),

  // Agent outputs
  baOutput: Annotation<BAOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  testPlanOutput: Annotation<TestPlanOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  implementationOutput: Annotation<ImplementationOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  devopsOutput: Annotation<DevOpsOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  testResults: Annotation<PlaywrightResult | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  finalReport: Annotation<FinalReport | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Message log (for potential LLM conversation history)
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // Event log for UI streaming
  events: Annotation<NovaflowEvent[]>({
    reducer: (existing, next) => [...existing, ...next],
    default: () => [],
  }),

  // Human-in-the-loop
  pendingCheckpoint: Annotation<HumanCheckpoint | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  checkpointDecision: Annotation<"approved" | "rejected" | "modified" | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  checkpointPayload: Annotation<Record<string, unknown> | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Run control
  status: Annotation<RunStatus>({
    reducer: (_, next) => next,
    default: () => "pending",
  }),
  error: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Routing flags
  requiresDevOps: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
  allTestsPassed: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
});

export type NovaflowStateType = typeof NovaflowState.State;
