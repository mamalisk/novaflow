import { EventEmitter } from "events";
import type { NovaflowEvent } from "@novaflow/shared-types";

/**
 * Singleton event bus that bridges LangGraph agent nodes to the Socket.io server.
 *
 * Stored on `global` so it is shared across all module instances — Next.js dev mode,
 * webpack bundles, and tsx all get the exact same EventEmitter object regardless of
 * which module instance imports this file.
 *
 * Events emitted:
 *   "agent:event" { runId: string; event: NovaflowEvent }
 *   "run:status"  { runId: string; status: string }
 *   "checkpoint:respond" { runId: string; decision: CheckpointDecision }  (inbound from socket)
 */
declare global {
  // eslint-disable-next-line no-var
  var __novaflowEventBus: EventEmitter | undefined;
}

if (!global.__novaflowEventBus) {
  global.__novaflowEventBus = new EventEmitter();
  global.__novaflowEventBus.setMaxListeners(50);
}

export const agentEventBus = global.__novaflowEventBus;

/** Called from within agent nodes to broadcast an event to connected clients. */
export function emitAgentEvent(runId: string, event: NovaflowEvent): void {
  agentEventBus.emit("agent:event", { runId, event });
}

/** Called from within agent nodes to update the run status. */
export function emitRunStatus(runId: string, status: string): void {
  agentEventBus.emit("run:status", { runId, status });
}
