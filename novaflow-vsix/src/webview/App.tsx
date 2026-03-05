import React, { useState, useEffect, useRef, useCallback } from "react";
import { marked } from "marked";
import { postMessage } from "./vscode.js";
import type { NovaflowEvent } from "../types/events.js";

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
}

interface KbFile {
  name: string;
  filename: string;
}

// ─── Extension host message types (inbound to webview) ───────────────────────
type HostMessage =
  | { type: "agent:event"; event: NovaflowEvent }
  | { type: "run:started"; runId: string }
  | { type: "status:update"; status: StatusResult }
  | { type: "kb:list"; files: KbFile[] };

export function App() {
  const [ticketId, setTicketId] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [specsOpen, setSpecsOpen] = useState(false);
  const [specsMode, setSpecsMode] = useState<"edit" | "preview">("edit");
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [checkpoint, setCheckpoint] = useState<(NovaflowEvent & { type: "checkpoint:required" }) | null>(null);
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [kbFiles, setKbFiles] = useState<KbFile[]>([]);
  const eventLogRef = useRef<HTMLDivElement>(null);

  // Listen for messages from extension host
  useEffect(() => {
    function onMessage(ev: MessageEvent<HostMessage>) {
      const msg = ev.data;
      if (msg.type === "kb:list") {
        setKbFiles(msg.files);
      } else if (msg.type === "agent:event") {
        setEvents((prev) => [
          ...prev,
          { id: crypto.randomUUID(), event: msg.event, timestamp: new Date().toISOString() },
        ]);
        if (msg.event.type === "checkpoint:required") {
          setCheckpoint(msg.event as NovaflowEvent & { type: "checkpoint:required" });
        }
        if (msg.event.type === "run:completed" || msg.event.type === "run:failed") {
          setIsRunning(false);
        }
      } else if (msg.type === "run:started") {
        setRunId(msg.runId);
      } else if (msg.type === "status:update") {
        setStatus(msg.status);
      }
      // kb:list handled above
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Request status on mount
  useEffect(() => {
    postMessage({ type: "status:request" });
  }, []);

  // Auto-scroll event log
  useEffect(() => {
    if (eventLogRef.current) {
      eventLogRef.current.scrollTop = eventLogRef.current.scrollHeight;
    }
  }, [events]);

  const handleRefreshStatus = useCallback(() => {
    postMessage({ type: "status:request" });
  }, []);

  function startRun() {
    if (!ticketId.trim()) return;
    setEvents([]);
    setCheckpoint(null);
    setIsRunning(true);
    postMessage({
      type: "run:start",
      ticketId: ticketId.trim(),
      additionalContext: additionalContext.trim() || undefined,
    });
  }

  function respondToCheckpoint(action: "approved" | "rejected") {
    if (!runId) return;
    setCheckpoint(null);
    postMessage({ type: "checkpoint:respond", runId, decision: { action } });
  }

  const canStartRun = !!ticketId.trim() && !isRunning && (status?.graphInitialized ?? false);

  return (
    <div style={styles.shell}>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.logo}>Novaflow</div>

        {runId && (
          <div style={styles.runIdBox}>
            <span style={styles.labelMuted}>Run ID</span>
            <code style={styles.code}>{runId.slice(0, 8)}…</code>
          </div>
        )}

        <KbPanel files={kbFiles} />

        <StatusPanel status={status} onRefresh={handleRefreshStatus} />
      </aside>

      {/* Main */}
      <main style={styles.main}>
        {/* Not-ready banner */}
        {status && !status.graphInitialized && (
          <div style={styles.notReadyBanner}>
            ⚠ Agents not initialized — check connection status or run{" "}
            <strong>Novaflow: Configure API Keys</strong>.
          </div>
        )}

        {/* Checkpoint banner */}
        {checkpoint && (
          <div style={styles.checkpointBanner}>
            <div style={styles.checkpointTitle}>
              Approval Required — <code>{checkpoint.gate}</code>
            </div>
            <div style={styles.checkpointBody}>
              <pre style={styles.checkpointPayload}>
                {JSON.stringify(checkpoint.payload, null, 2)}
              </pre>
            </div>
            <div style={styles.checkpointActions}>
              <button style={styles.buttonApprove} onClick={() => respondToCheckpoint("approved")}>
                Approve
              </button>
              <button style={styles.buttonReject} onClick={() => respondToCheckpoint("rejected")}>
                Reject
              </button>
            </div>
          </div>
        )}

        {/* Event log */}
        <div style={styles.eventLog} ref={eventLogRef}>
          {events.length === 0 && (
            <div style={styles.emptyState}>
              Enter a JIRA ticket ID and press <strong>Start Run →</strong> to begin.
            </div>
          )}
          {events.map(({ id, event, timestamp }) => (
            <EventRow key={id} event={event} timestamp={timestamp} />
          ))}
        </div>

        {/* Compose bar */}
        <div style={styles.composeBar}>
          {specsOpen && (
            <div style={styles.composeEditor}>
              <div style={styles.tabBar}>
                <span style={styles.specsLabel}>Additional Specifications</span>
                <div style={styles.tabGroup}>
                  <button
                    style={specsMode === "edit" ? styles.tabActive : styles.tab}
                    onClick={() => setSpecsMode("edit")}
                  >
                    Edit
                  </button>
                  <button
                    style={specsMode === "preview" ? styles.tabActive : styles.tab}
                    onClick={() => setSpecsMode("preview")}
                  >
                    Preview
                  </button>
                </div>
              </div>
              {specsMode === "edit" ? (
                <textarea
                  style={styles.specsTextarea}
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value)}
                  placeholder="Business rules, testing requirements, architecture constraints…"
                  disabled={isRunning}
                  spellCheck={false}
                />
              ) : (
                <div style={styles.specsPreview}>
                  {additionalContext ? (
                    <div
                      dangerouslySetInnerHTML={{ __html: marked(additionalContext) as string }}
                    />
                  ) : (
                    <p style={{ color: "#888", fontSize: "13px" }}>Nothing to preview yet.</p>
                  )}
                </div>
              )}
            </div>
          )}
          <div style={styles.composeInput}>
            <input
              style={styles.ticketInput}
              type="text"
              placeholder="PROJ-123"
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canStartRun && startRun()}
              disabled={isRunning}
            />
            <button
              style={specsOpen ? styles.specToggleActive : styles.specToggle}
              onClick={() => setSpecsOpen((o) => !o)}
              type="button"
            >
              {specsOpen ? "▲ Specs" : "✦ Specs"}
            </button>
            <button
              style={{ ...styles.button, opacity: canStartRun ? 1 : 0.4, cursor: canStartRun ? "pointer" : "not-allowed" }}
              onClick={() => canStartRun && startRun()}
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

// ─── Knowledge base panel ────────────────────────────────────────────────────

const KB_TEMPLATES = [
  { key: "architecture", label: "Architecture" },
  { key: "coding-conventions", label: "Coding Conventions" },
  { key: "test-strategy", label: "Test Strategy" },
  { key: "definition-of-done", label: "Definition of Done" },
  { key: "custom", label: "Custom…" },
];

function KbPanel({ files }: { files: KbFile[] }) {
  const [open, setOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [template, setTemplate] = useState("custom");

  function createFile() {
    const name = newName.trim() || template;
    postMessage({ type: "kb:create", name, template });
    setShowNew(false);
    setNewName("");
    setTemplate("custom");
  }

  return (
    <div style={{ borderTop: `1px solid ${border}`, paddingTop: "12px" }}>
      <button
        style={{ ...styles.statusPanelTitle, background: "none", border: "none", cursor: "pointer", width: "100%", textAlign: "left", color: textMuted, padding: 0 }}
        onClick={() => setOpen((o) => !o)}
      >
        Knowledge Base
        <span style={{ fontSize: "10px" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ marginTop: "6px" }}>
          {files.length === 0 ? (
            <div style={{ fontSize: "11px", color: textMuted, fontStyle: "italic", padding: "2px 0 6px" }}>
              No files yet
            </div>
          ) : (
            files.map((f) => (
              <div key={f.filename} style={{ display: "flex", alignItems: "center", gap: "4px", padding: "2px 0" }}>
                <button
                  style={{ flex: 1, background: "none", border: "none", color: "#c0c0c0", fontSize: "12px", cursor: "pointer", textAlign: "left", padding: "2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={f.filename}
                  onClick={() => postMessage({ type: "kb:open", filename: f.filename })}
                >
                  📄 {f.name}
                </button>
                <button
                  style={{ background: "none", border: "none", color: textMuted, fontSize: "10px", cursor: "pointer", flexShrink: 0, padding: "0 2px" }}
                  title="Delete"
                  onClick={() => postMessage({ type: "kb:delete", filename: f.filename })}
                >
                  ✕
                </button>
              </div>
            ))
          )}

          {showNew ? (
            <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "4px" }}>
              <select
                style={{ background: bgElevated, border: `1px solid ${border}`, color: "#e0e0e0", fontSize: "11px", borderRadius: "4px", padding: "3px 6px" }}
                value={template}
                onChange={(e) => { setTemplate(e.target.value); setNewName(""); }}
              >
                {KB_TEMPLATES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
              {template === "custom" && (
                <input
                  style={{ background: bgElevated, border: `1px solid ${border}`, color: "#e0e0e0", fontSize: "11px", borderRadius: "4px", padding: "3px 6px", outline: "none" }}
                  placeholder="filename (without .md)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createFile()}
                  autoFocus
                />
              )}
              <div style={{ display: "flex", gap: "4px" }}>
                <button style={{ flex: 1, ...styles.buttonApprove, padding: "4px 8px", fontSize: "11px" }} onClick={createFile}>Create</button>
                <button style={{ flex: 1, ...styles.buttonReject, padding: "4px 8px", fontSize: "11px" }} onClick={() => setShowNew(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button
              style={{ marginTop: "6px", ...styles.specToggle, width: "100%", fontSize: "11px", padding: "5px 8px" }}
              onClick={() => setShowNew(true)}
            >
              + New file
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Status panel ─────────────────────────────────────────────────────────────

function StatusPanel({
  status,
  onRefresh,
}: {
  status: StatusResult | null;
  onRefresh: () => void;
}) {
  const integrations: Array<{ key: keyof Omit<StatusResult, "graphInitialized">; label: string }> = [
    { key: "ai", label: "AI" },
    { key: "jira", label: "JIRA" },
    { key: "gitlab", label: "GitLab" },
  ];

  return (
    <div style={styles.statusPanel}>
      <div style={styles.statusPanelTitle}>
        Connections
        <button style={styles.statusRefresh} onClick={onRefresh}>↻</button>
      </div>

      <div style={styles.statusRow}>
        <span style={{ ...styles.dot, background: !status ? "#f59e0b" : status.graphInitialized ? "#4ade80" : "#f87171" }} />
        <span style={styles.statusName}>Graph</span>
        <span style={{ color: status?.graphInitialized ? "#4ade80" : "#888", fontSize: "11px" }}>
          {!status ? "checking…" : status.graphInitialized ? "ready" : "not initialized"}
        </span>
      </div>

      {integrations.map(({ key, label }) => {
        const s = status?.[key];
        return (
          <div key={key} style={styles.statusRow}>
            <span style={{ ...styles.dot, background: !s ? "#f59e0b" : s.ok ? "#4ade80" : "#f87171" }} />
            <span style={styles.statusName}>{label}</span>
            <span style={{ color: s?.ok ? "#4ade80" : "#888", fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s?.message}>
              {s?.message ?? "checking…"}
            </span>
          </div>
        );
      })}

      <button
        style={{ marginTop: "12px", ...styles.specToggle, width: "100%", textAlign: "center" }}
        onClick={() => postMessage({ type: "reinitialize" })}
      >
        ↺ Reinitialize
      </button>
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

  function renderDetail(): string {
    switch (event.type) {
      case "agent:started":       return `${event.agentId} started`;
      case "agent:thinking":      return `[${event.agentId}] ${event.message}`;
      case "agent:completed":     return `${event.agentId} completed — ${event.summary}`;
      case "agent:error":         return `${event.agentId} error: ${event.error}`;
      case "checkpoint:required": return `Checkpoint: ${event.gate} (${event.agentId})`;
      case "file:changed":        return `File changed: ${event.path}`;
      case "test:result":         return `${event.passed ? "PASS" : "FAIL"} ${event.testName}${event.error ? ` — ${event.error}` : ""}`;
      case "run:completed":       return `Run completed`;
      case "run:failed":          return `Run failed: ${event.error}`;
    }
  }

  return (
    <div style={{ display: "flex", gap: "12px", padding: "4px 0", borderBottom: "1px solid #1e1e1e" }}>
      <span style={{ color: "#555", fontFamily: "monospace", flexShrink: 0, fontSize: "12px" }}>{time}</span>
      <span style={{ color, fontFamily: "monospace", fontSize: "12px", flexShrink: 0 }}>{event.type}</span>
      <span style={{ color: "#ccc", fontSize: "13px" }}>{renderDetail()}</span>
    </div>
  );
}

// ─── Styles (inline — no CSS modules in webview IIFE bundle) ─────────────────

const accent = "#7c3aed";
const accentGlow = "rgba(124,58,237,0.15)";
const border = "#2a2a2a";
const bgSurface = "#111";
const bgElevated = "#1a1a1a";
const textMuted = "#666";
const success = "#4ade80";
const error = "#f87171";
const warning = "#facc15";

const styles = {
  shell: {
    display: "flex",
    height: "100vh",
    overflow: "hidden",
    background: "#0d0d0d",
    color: "#e0e0e0",
  } as React.CSSProperties,

  sidebar: {
    width: "220px",
    flexShrink: 0,
    background: bgSurface,
    borderRight: `1px solid ${border}`,
    display: "flex",
    flexDirection: "column" as const,
    gap: "16px",
    padding: "20px 14px",
    overflow: "hidden",
  } as React.CSSProperties,

  logo: {
    fontSize: "18px",
    fontWeight: 700,
    color: accent,
    letterSpacing: "-0.5px",
  } as React.CSSProperties,

  runIdBox: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "3px",
  } as React.CSSProperties,

  labelMuted: {
    fontSize: "10px",
    color: textMuted,
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  } as React.CSSProperties,

  code: {
    fontFamily: "monospace",
    fontSize: "11px",
    color: textMuted,
  } as React.CSSProperties,

  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
    minWidth: 0,
  } as React.CSSProperties,

  notReadyBanner: {
    background: "#1a0a00",
    border: `1px solid ${warning}`,
    borderRadius: "6px",
    margin: "10px 14px 0",
    padding: "10px 14px",
    fontSize: "12px",
    color: warning,
    lineHeight: 1.5,
    flexShrink: 0,
  } as React.CSSProperties,

  checkpointBanner: {
    background: "#1a1500",
    borderBottom: `2px solid ${warning}`,
    padding: "14px 18px",
    flexShrink: 0,
  } as React.CSSProperties,

  checkpointTitle: {
    fontWeight: 700,
    color: warning,
    marginBottom: "8px",
  } as React.CSSProperties,

  checkpointBody: {
    maxHeight: "180px",
    overflow: "auto",
    marginBottom: "10px",
  } as React.CSSProperties,

  checkpointPayload: {
    fontFamily: "monospace",
    fontSize: "11px",
    color: textMuted,
    whiteSpace: "pre-wrap" as const,
  } as React.CSSProperties,

  checkpointActions: {
    display: "flex",
    gap: "8px",
  } as React.CSSProperties,

  buttonApprove: {
    background: success,
    color: "#000",
    border: "none",
    borderRadius: "6px",
    padding: "6px 14px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
  } as React.CSSProperties,

  buttonReject: {
    background: error,
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    padding: "6px 14px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
  } as React.CSSProperties,

  eventLog: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "14px 18px",
    fontFamily: "monospace",
  } as React.CSSProperties,

  emptyState: {
    color: textMuted,
    fontFamily: "sans-serif",
    textAlign: "center" as const,
    marginTop: "60px",
    fontSize: "13px",
    lineHeight: 1.7,
  } as React.CSSProperties,

  composeBar: {
    flexShrink: 0,
    borderTop: `1px solid ${border}`,
    background: bgSurface,
  } as React.CSSProperties,

  composeEditor: {
    display: "flex",
    flexDirection: "column" as const,
    height: "240px",
    borderBottom: `1px solid ${border}`,
  } as React.CSSProperties,

  tabBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "7px 14px",
    borderBottom: `1px solid ${border}`,
    flexShrink: 0,
  } as React.CSSProperties,

  specsLabel: {
    fontSize: "10px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
    color: textMuted,
  } as React.CSSProperties,

  tabGroup: {
    display: "flex",
    gap: "2px",
  } as React.CSSProperties,

  tab: {
    background: "none",
    border: "none",
    padding: "3px 10px",
    fontSize: "11px",
    fontFamily: "inherit",
    color: textMuted,
    cursor: "pointer",
    borderRadius: "4px",
  } as React.CSSProperties,

  tabActive: {
    background: bgElevated,
    border: "none",
    padding: "3px 10px",
    fontSize: "11px",
    fontFamily: "inherit",
    color: "#e0e0e0",
    cursor: "pointer",
    borderRadius: "4px",
    fontWeight: 600,
  } as React.CSSProperties,

  specsTextarea: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    padding: "10px 14px",
    color: "#e0e0e0",
    fontSize: "13px",
    fontFamily: "sans-serif",
    lineHeight: 1.6,
    resize: "none" as const,
  } as React.CSSProperties,

  specsPreview: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "10px 14px",
    fontSize: "13px",
    fontFamily: "sans-serif",
    lineHeight: 1.6,
    color: "#e0e0e0",
  } as React.CSSProperties,

  composeInput: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "9px 14px",
  } as React.CSSProperties,

  ticketInput: {
    flex: 1,
    background: bgElevated,
    border: `1px solid ${border}`,
    borderRadius: "6px",
    padding: "8px 11px",
    color: "#e0e0e0",
    fontSize: "13px",
    fontFamily: "monospace",
    outline: "none",
    minWidth: 0,
  } as React.CSSProperties,

  specToggle: {
    background: "none",
    border: `1px solid ${border}`,
    borderRadius: "6px",
    padding: "7px 11px",
    fontSize: "12px",
    fontFamily: "inherit",
    color: textMuted,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
  } as React.CSSProperties,

  specToggleActive: {
    background: accentGlow,
    border: `1px solid ${accent}`,
    borderRadius: "6px",
    padding: "7px 11px",
    fontSize: "12px",
    fontFamily: "inherit",
    color: accent,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
  } as React.CSSProperties,

  button: {
    background: accent,
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    padding: "8px 14px",
    fontSize: "13px",
    fontWeight: 600,
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
  } as React.CSSProperties,

  // Status panel
  statusPanel: {
    borderTop: `1px solid ${border}`,
    paddingTop: "14px",
    marginTop: "auto",
  } as React.CSSProperties,

  statusPanelTitle: {
    fontSize: "10px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
    color: textMuted,
    marginBottom: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  } as React.CSSProperties,

  statusRefresh: {
    fontSize: "11px",
    color: textMuted,
    cursor: "pointer",
    background: "none",
    border: "none",
    fontFamily: "inherit",
    padding: "0",
  } as React.CSSProperties,

  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: "7px",
    fontSize: "12px",
    padding: "2px 0",
  } as React.CSSProperties,

  dot: {
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    flexShrink: 0,
  } as React.CSSProperties,

  statusName: {
    color: textMuted,
    width: "42px",
    flexShrink: 0,
  } as React.CSSProperties,
};
