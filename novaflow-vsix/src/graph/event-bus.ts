import { EventEmitter } from "events";
import type { NovaflowEvent } from "../types/index.js";

/**
 * Singleton event bus that bridges LangGraph agent nodes to the VS Code webview panel.
 *
 * Events emitted:
 *   "agent:event" { runId: string; event: NovaflowEvent }
 *   "run:status"  { runId: string; status: string }
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

export function emitAgentEvent(runId: string, event: NovaflowEvent): void {
  agentEventBus.emit("agent:event", { runId, event });
}

export function emitRunStatus(runId: string, status: string): void {
  agentEventBus.emit("run:status", { runId, status });
}
