"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { marked } from "marked";
import { io, type Socket } from "socket.io-client";
import type {
  NovaflowEvent,
  ServerToClientEvents,
  ClientToServerEvents,
} from "@novaflow/shared-types";
import styles from "./page.module.css";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface EventEntry {
  id: string;
  event: NovaflowEvent;
  timestamp: string;
}

interface IntegrationStatus {
  ok: boolean;
  message: string;
}

interface StatusResult {
  graphInitialized: boolean;
  ai: IntegrationStatus;
  jira: IntegrationStatus;
  gitlab: IntegrationStatus;
  figma: IntegrationStatus;
}

export default function HomePage() {
  const [ticketId, setTicketId] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [specsOpen, setSpecsOpen] = useState(false);
  const [specsMode, setSpecsMode] = useState<"edit" | "preview">("edit");
  const [runId, setRunId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [checkpoint, setCheckpoint] = useState<NovaflowEvent & { type: "checkpoint:required" } | null>(null);
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const socketRef = useRef<AppSocket | null>(null);
  const eventLogRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch("/api/status");
      const data = await res.json() as StatusResult;
      setStatus(data);
    } catch {
      // server may be momentarily unavailable
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    const socket: AppSocket = io({ transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("agent:event", (event) => {
      setEvents((prev) => [
        ...prev,
        { id: crypto.randomUUID(), event, timestamp: new Date().toISOString() },
      ]);

      if (event.type === "checkpoint:required") {
        setCheckpoint(event as NovaflowEvent & { type: "checkpoint:required" });
      }
      if (event.type === "run:completed" || event.type === "run:failed") {
        setIsRunning(false);
      }
    });

    return () => { socket.disconnect(); };
  }, []);

  // Fetch status on mount and every 30 s
  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => { void fetchStatus(); }, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Auto-scroll event log
  useEffect(() => {
    if (eventLogRef.current) {
      eventLogRef.current.scrollTop = eventLogRef.current.scrollHeight;
    }
  }, [events]);

  async function startRun() {
    if (!ticketId.trim()) return;
    setEvents([]);
    setCheckpoint(null);
    setIsRunning(true);

    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jiraTicketId: ticketId.trim(),
        additionalContext: additionalContext.trim() || undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.json() as { error: string };
      setEvents([{
        id: crypto.randomUUID(),
        event: { type: "run:failed", error: err.error },
        timestamp: new Date().toISOString(),
      }]);
      setIsRunning(false);
      return;
    }

    const data = await res.json() as { runId: string };
    setRunId(data.runId);
    socketRef.current?.emit("run:subscribe", data.runId);
  }

  async function respondToCheckpoint(action: "approved" | "rejected") {
    if (!runId || !checkpoint) return;
    setCheckpoint(null);

    await fetch("/api/checkpoint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, decision: { action } }),
    });
  }

  const canStartRun = connected && !!ticketId.trim() && !isRunning && (status?.graphInitialized ?? false);

  return (
    <div className={styles.shell}>
      {/* Sidebar — logo, nav, connection status */}
      <aside className={styles.sidebar}>
        <div className={styles.logo}>Novaflow</div>
        <div className={styles.wsStatus}>
          <span className={connected ? styles.dotGreen : styles.dotRed} />
          {connected ? "Connected" : "Disconnected"}
        </div>

        {runId && (
          <div className={styles.runId}>
            <span className={styles.labelMuted}>Run ID</span>
            <code className={styles.code}>{runId.slice(0, 8)}…</code>
          </div>
        )}

        <Link href="/knowledge" className={styles.navLink}>
          Knowledge Base →
        </Link>

        <ConnectionStatusPanel
          status={status}
          loading={statusLoading}
          onRefresh={fetchStatus}
        />
      </aside>

      {/* Main — event log + sticky compose bar */}
      <main className={styles.main}>
        {/* Not-ready banner */}
        {status && !status.graphInitialized && (
          <div className={styles.notReadyBanner}>
            ⚠ Agents not initialized — check connection status and restart the server.
            Run <code>novaflow init</code> to reconfigure.
          </div>
        )}

        {/* Checkpoint banner */}
        {checkpoint && (
          <div className={styles.checkpointBanner}>
            <div className={styles.checkpointTitle}>
              Approval Required — <code>{checkpoint.gate}</code>
            </div>
            <div className={styles.checkpointBody}>
              <pre className={styles.checkpointPayload}>
                {JSON.stringify(checkpoint.payload, null, 2)}
              </pre>
            </div>
            <div className={styles.checkpointActions}>
              <button
                className={styles.buttonApprove}
                onClick={() => respondToCheckpoint("approved")}
              >
                Approve
              </button>
              <button
                className={styles.buttonReject}
                onClick={() => respondToCheckpoint("rejected")}
              >
                Reject
              </button>
            </div>
          </div>
        )}

        {/* Event log */}
        <div className={styles.eventLog} ref={eventLogRef}>
          {events.length === 0 && (
            <div className={styles.emptyState}>
              Enter a JIRA ticket ID and press <strong>Start Run →</strong> to begin.
            </div>
          )}
          {events.map(({ id, event, timestamp }) => (
            <EventRow key={id} event={event} timestamp={timestamp} />
          ))}
        </div>

        {/* Compose bar — sticky bottom */}
        <div className={styles.composeBar}>
          {specsOpen && (
            <div className={styles.composeEditor}>
              <div className={styles.tabBar}>
                <span className={styles.specsLabel}>Additional Specifications</span>
                <div className={styles.tabGroup}>
                  <button
                    className={specsMode === "edit" ? styles.tabActive : styles.tab}
                    onClick={() => setSpecsMode("edit")}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className={specsMode === "preview" ? styles.tabActive : styles.tab}
                    onClick={() => setSpecsMode("preview")}
                    type="button"
                  >
                    Preview
                  </button>
                </div>
              </div>
              {specsMode === "edit" ? (
                <textarea
                  className={styles.specsTextarea}
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value)}
                  placeholder="Business rules, testing requirements, architecture constraints, or any other context for the agents…"
                  disabled={isRunning}
                  spellCheck={false}
                />
              ) : (
                <div className={styles.specsPreview}>
                  {additionalContext ? (
                    <div
                      dangerouslySetInnerHTML={{ __html: marked(additionalContext) as string }}
                    />
                  ) : (
                    <p className={styles.specsPreviewEmpty}>Nothing to preview yet.</p>
                  )}
                </div>
              )}
            </div>
          )}
          <div className={styles.composeInput}>
            <input
              className={styles.ticketInput}
              type="text"
              placeholder="PROJ-123"
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canStartRun && void startRun()}
              disabled={isRunning}
            />
            <button
              className={specsOpen ? styles.specToggleActive : styles.specToggle}
              onClick={() => setSpecsOpen((o) => !o)}
              type="button"
              title="Additional Specifications"
            >
              {specsOpen ? "▲ Specs" : "✦ Specs"}
            </button>
            <button
              className={styles.button}
              onClick={() => void startRun()}
              disabled={!canStartRun}
            >
              {isRunning ? "Running…" : "Start Run →"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Connection status panel ──────────────────────────────────────────────────

function ConnectionStatusPanel({
  status,
  loading,
  onRefresh,
}: {
  status: StatusResult | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const integrations: Array<{ key: keyof Omit<StatusResult, "graphInitialized">; label: string }> = [
    { key: "ai", label: "AI" },
    { key: "jira", label: "JIRA" },
    { key: "gitlab", label: "GitLab" },
    { key: "figma", label: "Figma" },
  ];

  return (
    <div className={styles.statusPanel}>
      <div className={styles.statusPanelTitle}>
        Connections
        <button className={styles.statusRefresh} onClick={onRefresh} disabled={loading}>
          {loading ? "…" : "↻ refresh"}
        </button>
      </div>

      {/* Graph init indicator */}
      <div className={styles.statusRow}>
        <span
          className={
            !status ? styles.dotYellow
              : status.graphInitialized ? styles.dotGreen
                : styles.dotRed
          }
        />
        <span className={styles.statusName}>Graph</span>
        <span className={status?.graphInitialized ? styles.statusMessageOk : styles.statusMessage}>
          {!status ? "checking…" : status.graphInitialized ? "ready" : "not initialized"}
        </span>
      </div>

      {integrations.map(({ key, label }) => {
        const s = status?.[key];
        return (
          <div key={key} className={styles.statusRow}>
            <span
              className={
                !s ? styles.dotYellow
                  : s.ok ? styles.dotGreen
                    : styles.dotRed
              }
            />
            <span className={styles.statusName}>{label}</span>
            <span
              className={s?.ok ? styles.statusMessageOk : styles.statusMessage}
              title={s?.message}
            >
              {s?.message ?? "checking…"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Event row ────────────────────────────────────────────────────────────────

function EventRow({ event, timestamp }: { event: NovaflowEvent; timestamp: string }) {
  const time = new Date(timestamp).toLocaleTimeString();

  const colorMap: Record<NovaflowEvent["type"], string> = {
    "agent:started": "#60a5fa",
    "agent:thinking": "#888",
    "agent:completed": "#4ade80",
    "agent:error": "#f87171",
    "checkpoint:required": "#facc15",
    "file:changed": "#c084fc",
    "test:result": "#4ade80",
    "run:completed": "#4ade80",
    "run:failed": "#f87171",
  };

  const color = colorMap[event.type] ?? "#888";

  function renderDetail() {
    switch (event.type) {
      case "agent:started":
        return `${event.agentId} started`;
      case "agent:thinking":
        return `[${event.agentId}] ${event.message}`;
      case "agent:completed":
        return `${event.agentId} completed — ${event.summary}`;
      case "agent:error":
        return `${event.agentId} error: ${event.error}`;
      case "checkpoint:required":
        return `Checkpoint: ${event.gate} (${event.agentId})`;
      case "file:changed":
        return `File changed: ${event.path}`;
      case "test:result":
        return `${event.passed ? "PASS" : "FAIL"} ${event.testName}${event.error ? ` — ${event.error}` : ""}`;
      case "run:completed":
        return `Run completed`;
      case "run:failed":
        return `Run failed: ${event.error}`;
    }
  }

  return (
    <div style={{ display: "flex", gap: "12px", padding: "4px 0", borderBottom: "1px solid #1e1e1e" }}>
      <span style={{ color: "#555", fontFamily: "monospace", flexShrink: 0, fontSize: "12px" }}>{time}</span>
      <span style={{ color, fontFamily: "monospace", fontSize: "12px" }}>{event.type}</span>
      <span style={{ color: "#ccc", fontSize: "13px" }}>{renderDetail()}</span>
    </div>
  );
}
