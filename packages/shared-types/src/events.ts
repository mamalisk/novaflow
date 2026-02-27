import type { AgentId, GateName, CheckpointDecision } from "./run.js";

// Every event an agent can emit — discriminated union
export type NovaflowEvent =
  | {
      type: "agent:started";
      agentId: AgentId;
      timestamp: string;
    }
  | {
      type: "agent:thinking";
      agentId: AgentId;
      message: string;
    }
  | {
      type: "agent:completed";
      agentId: AgentId;
      summary: string;
      durationMs: number;
    }
  | {
      type: "agent:error";
      agentId: AgentId;
      error: string;
    }
  | {
      type: "checkpoint:required";
      gate: GateName;
      agentId: AgentId;
      payload: unknown;
    }
  | {
      type: "file:changed";
      path: string;
      diff: string;
    }
  | {
      type: "test:result";
      passed: boolean;
      testName: string;
      error?: string;
    }
  | {
      type: "run:completed";
      reportUrl: string;
    }
  | {
      type: "run:failed";
      error: string;
    };

// Typed Socket.io event maps
export interface ServerToClientEvents {
  "agent:event": (event: NovaflowEvent) => void;
  "run:status": (status: { runId: string; status: string }) => void;
}

export interface ClientToServerEvents {
  "run:subscribe": (runId: string) => void;
  "checkpoint:respond": (payload: {
    runId: string;
    decision: CheckpointDecision;
  }) => void;
}

export interface InterServerEvents {
  // reserved for future multi-server setup
}

export interface SocketData {
  runId?: string;
}
