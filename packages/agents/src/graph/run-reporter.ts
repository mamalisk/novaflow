import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { NovaflowStateType } from "./state.js";

/**
 * Writes per-agent Markdown report files to .novaflow/reports/<runId>/.
 * Called after every graph run completes (happy path, rejected checkpoints, or errors).
 */
export function writeRunReport(state: NovaflowStateType): void {
  const projectDir = process.env.NOVAFLOW_PROJECT_DIR ?? process.cwd();
  const reportDir = join(projectDir, ".novaflow", "reports", state.runId);

  try {
    mkdirSync(reportDir, { recursive: true });
  } catch {
    return; // can't create dir — skip silently
  }

  const now = new Date().toISOString();

  // Always write summary
  write(reportDir, "summary.md", buildSummary(state, now));

  if (state.jiraTicket) {
    write(reportDir, "01-fetch-jira.md", buildFetchJira(state));
  }
  if (state.baOutput) {
    write(reportDir, "02-business-analyst.md", buildBusinessAnalyst(state));
  }
  if (state.testPlanOutput) {
    write(reportDir, "03-test-analyst.md", buildTestAnalyst(state));
  }
  if (state.implementationOutput) {
    write(reportDir, "04-developer.md", buildDeveloper(state));
  }
  if (state.devopsOutput) {
    write(reportDir, "05-devops.md", buildDevOps(state));
  }
  if (state.testResults) {
    write(reportDir, "06-playwright-runner.md", buildPlaywrightRunner(state));
  }
  if (state.finalReport) {
    write(reportDir, "07-report-generator.md", buildReportGenerator(state));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function write(dir: string, filename: string, content: string): void {
  try {
    writeFileSync(join(dir, filename), content, "utf-8");
  } catch {
    // skip silently — don't let report writing crash the run
  }
}

function status(state: NovaflowStateType): string {
  if (state.status === "completed") return "completed";
  if (state.error) return "failed";
  return state.status ?? "unknown";
}

function tick(v: unknown): string {
  return v ? "✓" : "✗";
}

// ─── summary.md ───────────────────────────────────────────────────────────────

function buildSummary(state: NovaflowStateType, now: string): string {
  const lines: string[] = [
    `# Run Report`,
    ``,
    `**Run ID:** \`${state.runId}\``,
    `**Ticket:** ${state.jiraTicketId || "—"}`,
    `**Status:** ${status(state)}`,
    `**Generated:** ${now}`,
    ``,
    `## Pipeline`,
    ``,
    `| Agent | Output |`,
    `|---|---|`,
    `| fetch-jira | ${tick(state.jiraTicket)} |`,
    `| business-analyst | ${tick(state.baOutput)} |`,
    `| test-analyst | ${tick(state.testPlanOutput)} |`,
    `| developer | ${tick(state.implementationOutput)} |`,
    `| devops | ${state.requiresDevOps ? tick(state.devopsOutput) : "— (not required)"} |`,
    `| playwright-runner | ${tick(state.testResults)} |`,
    `| report-generator | ${tick(state.finalReport)} |`,
  ];

  if (state.error) {
    lines.push(``, `## Error`, ``, `\`\`\``, state.error, `\`\`\``);
  }

  return lines.join("\n");
}

// ─── 01-fetch-jira.md ─────────────────────────────────────────────────────────

function buildFetchJira(state: NovaflowStateType): string {
  const t = state.jiraTicket!;
  const lines: string[] = [
    `# Fetch JIRA`,
    ``,
    `**Ticket ID:** ${t.id}`,
    `**Priority:** ${t.priority}`,
    `**Labels:** ${t.labels.join(", ") || "—"}`,
    `**Components:** ${t.components.join(", ") || "—"}`,
    ``,
    `## Summary`,
    ``,
    t.summary,
    ``,
    `## Description`,
    ``,
    t.description || "—",
  ];

  if (t.acceptanceCriteria.length > 0) {
    lines.push(``, `## Acceptance Criteria`, ``);
    for (const ac of t.acceptanceCriteria) {
      lines.push(`- ${ac}`);
    }
  }

  return lines.join("\n");
}

// ─── 02-business-analyst.md ───────────────────────────────────────────────────

function buildBusinessAnalyst(state: NovaflowStateType): string {
  const ba = state.baOutput!;
  const lines: string[] = [
    `# Business Analyst`,
    ``,
    `**Confidence:** ${Math.round(ba.confidence * 100)}%`,
    `**Requires DevOps changes:** ${ba.requiresDevOps ? "Yes" : "No"}`,
    ``,
    `## Summary`,
    ``,
    ba.summary,
  ];

  if (ba.acceptanceCriteria.length > 0) {
    lines.push(``, `## Acceptance Criteria`, ``);
    for (const ac of ba.acceptanceCriteria) lines.push(`- ${ac}`);
  }

  if (ba.affectedComponents.length > 0) {
    lines.push(``, `## Affected Components`, ``);
    for (const c of ba.affectedComponents) lines.push(`- ${c}`);
  }

  if (ba.risks.length > 0) {
    lines.push(``, `## Risks`, ``);
    for (const r of ba.risks) lines.push(`- ${r}`);
  }

  if (ba.figmaReferences.length > 0) {
    lines.push(``, `## Figma References`, ``);
    for (const f of ba.figmaReferences) lines.push(`- \`${f.nodeId}\` — ${f.description}`);
  }

  if (ba.clarifications.length > 0) {
    lines.push(``, `## Clarifications Needed`, ``);
    for (const c of ba.clarifications) lines.push(`- ${c}`);
  }

  return lines.join("\n");
}

// ─── 03-test-analyst.md ───────────────────────────────────────────────────────

function buildTestAnalyst(state: NovaflowStateType): string {
  const tp = state.testPlanOutput!;
  const lines: string[] = [`# Test Analyst`, ``];

  if (tp.automatedTests.length > 0) {
    lines.push(`## Automated Tests`, ``);
    lines.push(`| Name | Type | Description |`);
    lines.push(`|---|---|---|`);
    for (const t of tp.automatedTests) {
      lines.push(`| ${t.name} | ${t.type} | ${t.description} |`);
    }
  }

  if (tp.manualTests.length > 0) {
    lines.push(``, `## Manual Tests`, ``);
    for (const t of tp.manualTests) {
      lines.push(`### ${t.name}`, ``);
      lines.push(`**Steps:**`, ``);
      for (let i = 0; i < t.steps.length; i++) {
        lines.push(`${i + 1}. ${t.steps[i]}`);
      }
      lines.push(``, `**Expected result:** ${t.expectedResult}`, ``);
    }
  }

  if (tp.automationRecommendations.length > 0) {
    lines.push(`## Automation Recommendations`, ``);
    for (const r of tp.automationRecommendations) lines.push(`- ${r}`);
  }

  return lines.join("\n");
}

// ─── 04-developer.md ──────────────────────────────────────────────────────────

function buildDeveloper(state: NovaflowStateType): string {
  const impl = state.implementationOutput!;
  const lines: string[] = [
    `# Developer`,
    ``,
    `**Branch:** \`${impl.branchName}\``,
    ``,
    `## Summary`,
    ``,
    impl.summary,
    ``,
    `## Changed Files`,
    ``,
  ];

  for (const c of impl.changes) {
    lines.push(`- \`${c.path}\` (${c.action})`);
  }

  return lines.join("\n");
}

// ─── 05-devops.md ─────────────────────────────────────────────────────────────

function buildDevOps(state: NovaflowStateType): string {
  const d = state.devopsOutput!;
  const lines: string[] = [
    `# DevOps`,
    ``,
    `## Summary`,
    ``,
    d.summary,
    ``,
    `## Pipeline Changes`,
    ``,
  ];

  if (d.pipelineChanges.length === 0) {
    lines.push("No pipeline files changed.");
  } else {
    for (const c of d.pipelineChanges) {
      lines.push(`- \`${c.path}\` (${c.action})`);
    }
  }

  return lines.join("\n");
}

// ─── 06-playwright-runner.md ──────────────────────────────────────────────────

function buildPlaywrightRunner(state: NovaflowStateType): string {
  const r = state.testResults!;
  const total = r.passed + r.failed + r.skipped;
  const pct = total > 0 ? Math.round((r.passed / total) * 100) : 0;

  const lines: string[] = [
    `# Playwright Runner`,
    ``,
    `**Passed:** ${r.passed} / ${total} (${pct}%)`,
    `**Failed:** ${r.failed}`,
    `**Skipped:** ${r.skipped}`,
  ];

  const failed = r.results.filter((t) => !t.passed);
  if (failed.length > 0) {
    lines.push(``, `## Failed Tests`, ``);
    for (const t of failed) {
      lines.push(`- **${t.name}**${t.error ? ` — ${t.error}` : ""}`);
    }
  }

  if (r.results.length > 0) {
    lines.push(``, `## All Results`, ``);
    lines.push(`| Test | Status | Duration |`);
    lines.push(`|---|---|---|`);
    for (const t of r.results) {
      lines.push(`| ${t.name} | ${t.passed ? "PASS" : "FAIL"} | ${t.duration}ms |`);
    }
  }

  return lines.join("\n");
}

// ─── 07-report-generator.md ───────────────────────────────────────────────────

function buildReportGenerator(state: NovaflowStateType): string {
  const fr = state.finalReport!;
  const lines: string[] = [
    `# Final Report`,
    ``,
    `**Run ID:** \`${fr.runId}\``,
    `**Ticket:** ${fr.jiraTicketId}`,
    `**Completed:** ${fr.completedAt}`,
  ];

  if (fr.mrUrl) {
    lines.push(`**MR:** ${fr.mrUrl}`);
  }

  if (Object.keys(fr.agentSummaries).length > 0) {
    lines.push(``, `## Agent Summaries`, ``);
    lines.push(`| Agent | Summary |`);
    lines.push(`|---|---|`);
    for (const [agent, summary] of Object.entries(fr.agentSummaries)) {
      lines.push(`| ${agent} | ${summary} |`);
    }
  }

  if (fr.manualTestReport && fr.manualTestReport.length > 0) {
    lines.push(``, `## Manual Tests to Perform`, ``);
    for (const t of fr.manualTestReport) {
      lines.push(`### ${t.name}`, ``);
      for (let i = 0; i < t.steps.length; i++) {
        lines.push(`${i + 1}. ${t.steps[i]}`);
      }
      lines.push(``, `**Expected:** ${t.expectedResult}`, ``);
    }
  }

  return lines.join("\n");
}
