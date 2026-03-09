import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { emitAgentEvent } from "../graph/event-bus.js";
import type { NovaflowStateType, TestPlanOutput } from "../graph/state.js";

const TestPlanSchema = z.object({
  automatedTests: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["unit", "integration", "e2e"]),
      description: z.string(),
    })
  ),
  manualTests: z.array(
    z.object({
      name: z.string(),
      steps: z.array(z.string()),
      expectedResult: z.string(),
    })
  ),
  automationRecommendations: z.array(z.string()),
});

const TEST_SYSTEM_PROMPT = `You are a Senior QA Engineer and Test Analyst.
Based on the business analysis provided, create a comprehensive test plan.
Distinguish clearly between what should be automated (unit, integration, e2e) and what requires manual testing.
For e2e tests, assume Playwright as the automation framework.`;

export function createTestAnalystNode(llm: BaseChatModel) {
  return async function testAnalystNode(
    state: NovaflowStateType
  ): Promise<Partial<NovaflowStateType>> {
    const start = Date.now();

    emitAgentEvent(state.runId, {
      type: "agent:started",
      agentId: "test-analyst",
      timestamp: new Date().toISOString(),
    });

    if (!state.baOutput) {
      const error = "No business analysis available";
      emitAgentEvent(state.runId, { type: "agent:error", agentId: "test-analyst", error });
      return { error, status: "failed" };
    }

    emitAgentEvent(state.runId, {
      type: "agent:thinking",
      agentId: "test-analyst",
      message: "Creating test plan based on business analysis...",
    });

    try {
      const prompt = ChatPromptTemplate.fromMessages([
        ["system", TEST_SYSTEM_PROMPT],
        [
          "human",
          `Business Analysis:
Summary: {summary}
Acceptance Criteria: {acceptanceCriteria}
Affected Components: {affectedComponents}
Risks: {risks}{kbContext}{additionalContext}`,
        ],
      ]);

      const chain = prompt.pipe(llm.withStructuredOutput(TestPlanSchema));

      const result = await chain.invoke({
        summary: state.baOutput.summary,
        acceptanceCriteria: state.baOutput.acceptanceCriteria.join("\n"),
        affectedComponents: state.baOutput.affectedComponents.join(", "),
        risks: state.baOutput.risks.join("\n"),
        kbContext: state.kbContext
          ? `\n\n## Project Context\n${state.kbContext}`
          : "",
        additionalContext: state.additionalContext
          ? `\n\nAdditional Specifications:\n${state.additionalContext}`
          : "",
      }) as TestPlanOutput;

      emitAgentEvent(state.runId, {
        type: "agent:completed",
        agentId: "test-analyst",
        summary: `${result.automatedTests.length} automated, ${result.manualTests.length} manual tests planned`,
        durationMs: Date.now() - start,
      });

      return { testPlanOutput: result };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      emitAgentEvent(state.runId, { type: "agent:error", agentId: "test-analyst", error });
      return { error, status: "failed" };
    }
  };
}
