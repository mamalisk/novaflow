import { emitAgentEvent } from "../graph/event-bus.js";
import type { NovaflowStateType, FinalReport } from "../graph/state.js";

export function createReportGeneratorNode() {
  return async function reportGeneratorNode(
    state: NovaflowStateType
  ): Promise<Partial<NovaflowStateType>> {
    const start = Date.now();

    emitAgentEvent(state.runId, {
      type: "agent:started",
      agentId: "report-generator",
      timestamp: new Date().toISOString(),
    });

    const agentSummaries: Record<string, string> = {};

    if (state.baOutput) agentSummaries["business-analyst"] = state.baOutput.summary;
    if (state.testPlanOutput) {
      agentSummaries["test-analyst"] =
        `${state.testPlanOutput.automatedTests.length} automated tests, ` +
        `${state.testPlanOutput.manualTests.length} manual tests planned`;
    }
    if (state.implementationOutput) {
      agentSummaries["developer"] =
        `${state.implementationOutput.changes.length} files changed. ${state.implementationOutput.summary}`;
    }
    if (state.devopsOutput) agentSummaries["devops"] = state.devopsOutput.summary;
    if (state.testResults) {
      agentSummaries["playwright-runner"] =
        `${state.testResults.passed}/${state.testResults.passed + state.testResults.failed} tests passed`;
    }

    const report: FinalReport = {
      runId: state.runId,
      jiraTicketId: state.jiraTicketId,
      completedAt: new Date().toISOString(),
      agentSummaries,
      testResults: state.testResults ?? undefined,
      manualTestReport: state.testPlanOutput?.manualTests,
    };

    emitAgentEvent(state.runId, {
      type: "agent:completed",
      agentId: "report-generator",
      summary: "Final report generated",
      durationMs: Date.now() - start,
    });

    emitAgentEvent(state.runId, {
      type: "run:completed",
      reportUrl: `.novaflow/reports/${state.runId}/summary.md`,
    });

    return { finalReport: report, status: "completed" };
  };
}
