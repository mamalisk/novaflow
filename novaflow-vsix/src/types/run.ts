export type RunStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentId =
  | "orchestrator"
  | "fetch-jira"
  | "business-analyst"
  | "test-analyst"
  | "developer"
  | "devops"
  | "playwright-runner"
  | "report-generator";

export type GateName =
  | "post-ba"
  | "pre-impl"
  | "pre-commit"
  | "agent-uncertainty";

export interface CheckpointDecision {
  action: "approved" | "rejected" | "modified";
  payload?: Record<string, unknown>;
  comment?: string;
}

export interface RunSummary {
  runId: string;
  jiraTicketId: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
}
