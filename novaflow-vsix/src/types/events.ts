import type { AgentId, GateName } from "./run.js";

export type NovaflowEvent =
  | { type: "agent:started"; agentId: AgentId; timestamp: string }
  | { type: "agent:thinking"; agentId: AgentId; message: string }
  | { type: "agent:completed"; agentId: AgentId; summary: string; durationMs: number }
  | { type: "agent:error"; agentId: AgentId; error: string }
  | { type: "checkpoint:required"; gate: GateName; agentId: AgentId; payload: unknown }
  | { type: "file:changed"; path: string; diff: string }
  | { type: "test:result"; passed: boolean; testName: string; error?: string }
  | { type: "run:completed"; reportUrl: string }
  | { type: "run:failed"; error: string };
