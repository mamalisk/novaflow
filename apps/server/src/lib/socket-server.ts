import type { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  NovaflowEvent,
} from "@novaflow/shared-types";
import { agentEventBus } from "@novaflow/agents";

type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

let ioInstance: TypedServer | null = null;

export function initSocketServer(io: TypedServer): void {
  ioInstance = io;

  io.on("connection", (socket) => {
    console.log(`[socket] client connected: ${socket.id}`);

    // Client joins a specific run's room to receive its events
    socket.on("run:subscribe", (runId: string) => {
      socket.join(runId);
      socket.data.runId = runId;
      console.log(`[socket] ${socket.id} subscribed to run ${runId}`);
    });

    // Client responds to a checkpoint (approve/reject/modify)
    socket.on("checkpoint:respond", async ({ runId, decision }) => {
      console.log(`[socket] checkpoint response for run ${runId}: ${decision.action}`);
      // Forward to the agents package to resume the LangGraph graph
      agentEventBus.emit("checkpoint:respond", { runId, decision });
    });

    socket.on("disconnect", () => {
      console.log(`[socket] client disconnected: ${socket.id}`);
    });
  });

  // Bridge: agent event bus → Socket.io broadcast
  agentEventBus.on("agent:event", ({ runId, event }: { runId: string; event: NovaflowEvent }) => {
    io.to(runId).emit("agent:event", event);
  });

  agentEventBus.on("run:status", ({ runId, status }: { runId: string; status: string }) => {
    io.to(runId).emit("run:status", { runId, status });
  });
}

export function getIO(): TypedServer {
  if (!ioInstance) throw new Error("Socket.io server not initialized");
  return ioInstance;
}
