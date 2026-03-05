import { execSync } from "child_process";
import { emitAgentEvent } from "../graph/event-bus.js";
import type { NovaflowStateType, PlaywrightResult } from "../graph/state.js";

export function createPlaywrightRunnerNode() {
  return async function playwrightRunnerNode(
    state: NovaflowStateType
  ): Promise<Partial<NovaflowStateType>> {
    const start = Date.now();

    emitAgentEvent(state.runId, {
      type: "agent:started",
      agentId: "playwright-runner",
      timestamp: new Date().toISOString(),
    });

    emitAgentEvent(state.runId, {
      type: "agent:thinking",
      agentId: "playwright-runner",
      message: "Running Playwright tests...",
    });

    try {
      let output: string;
      try {
        output = execSync("npx playwright test --reporter=json", {
          encoding: "utf-8",
          timeout: 300_000,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (err) {
        output = (err as { stdout?: string }).stdout ?? "{}";
      }

      const report = parsePlaywrightOutput(output);

      for (const result of report.results) {
        emitAgentEvent(state.runId, {
          type: "test:result",
          passed: result.passed,
          testName: result.name,
          error: result.error,
        });
      }

      emitAgentEvent(state.runId, {
        type: "agent:completed",
        agentId: "playwright-runner",
        summary: `${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped`,
        durationMs: Date.now() - start,
      });

      return { testResults: report, allTestsPassed: report.failed === 0 };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      emitAgentEvent(state.runId, { type: "agent:error", agentId: "playwright-runner", error });
      return {
        testResults: { passed: 0, failed: 0, skipped: 0, results: [] },
        allTestsPassed: false,
      };
    }
  };
}

function parsePlaywrightOutput(output: string): PlaywrightResult {
  try {
    const json = JSON.parse(output) as {
      stats?: { expected?: number; unexpected?: number; skipped?: number };
      suites?: Array<{
        specs?: Array<{
          title: string;
          ok: boolean;
          tests?: Array<{ results?: Array<{ error?: { message: string } }> }>;
        }>;
      }>;
    };

    const results: PlaywrightResult["results"] = [];
    for (const suite of json.suites ?? []) {
      for (const spec of suite.specs ?? []) {
        const firstError = spec.tests?.[0]?.results?.[0]?.error?.message;
        results.push({ name: spec.title, passed: spec.ok, error: firstError, duration: 0 });
      }
    }

    return {
      passed: json.stats?.expected ?? results.filter((r) => r.passed).length,
      failed: json.stats?.unexpected ?? results.filter((r) => !r.passed).length,
      skipped: json.stats?.skipped ?? 0,
      results,
    };
  } catch {
    return { passed: 0, failed: 0, skipped: 0, results: [] };
  }
}
