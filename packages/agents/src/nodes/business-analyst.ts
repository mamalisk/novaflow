import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { emitAgentEvent } from "../graph/event-bus.js";
import type { NovaflowStateType, BAOutput } from "../graph/state.js";

const BAOutputSchema = z.object({
  summary: z.string().describe("Concise summary of what needs to be built"),
  acceptanceCriteria: z.array(z.string()).describe("Structured acceptance criteria"),
  affectedComponents: z.array(z.string()).describe("Code components/modules that will be affected"),
  risks: z.array(z.string()).describe("Potential risks or blockers"),
  requiresDevOps: z.boolean().describe("Whether CI/CD pipeline changes are needed"),
  figmaReferences: z
    .array(z.object({ nodeId: z.string(), description: z.string() }))
    .describe("Relevant Figma design references"),
  clarifications: z.array(z.string()).describe("Unclear points that may need human clarification"),
  confidence: z.number().min(0).max(1).describe("Confidence score 0-1 for this analysis"),
});

const BA_SYSTEM_PROMPT = `You are an expert Business Analyst specializing in software development.
Analyze the provided JIRA ticket and produce a structured business analysis.
Be precise, actionable, and highlight any ambiguities or risks.
If you are uncertain about something, list it in clarifications.`;

export function createBusinessAnalystNode(llm: BaseChatModel) {
  return async function businessAnalystNode(
    state: NovaflowStateType
  ): Promise<Partial<NovaflowStateType>> {
    const start = Date.now();

    emitAgentEvent(state.runId, {
      type: "agent:started",
      agentId: "business-analyst",
      timestamp: new Date().toISOString(),
    });

    if (!state.jiraTicket) {
      const error = "No JIRA ticket data available";
      emitAgentEvent(state.runId, { type: "agent:error", agentId: "business-analyst", error });
      return { error, status: "failed" };
    }

    emitAgentEvent(state.runId, {
      type: "agent:thinking",
      agentId: "business-analyst",
      message: "Analyzing ticket requirements and acceptance criteria...",
    });

    try {
      const prompt = ChatPromptTemplate.fromMessages([
        ["system", BA_SYSTEM_PROMPT],
        [
          "human",
          `JIRA Ticket: {ticketId}
Summary: {summary}
Description: {description}
Acceptance Criteria: {acceptanceCriteria}
Priority: {priority}
Labels: {labels}
Components: {components}
Figma URL: {figmaUrl}{additionalContext}`,
        ],
      ]);

      const chain = prompt.pipe(llm.withStructuredOutput(BAOutputSchema));

      const contextSection = state.additionalContext
        ? `\n\nAdditional Specifications:\n${state.additionalContext}`
        : "";

      const result = await chain.invoke({
        ticketId: state.jiraTicket.id,
        summary: state.jiraTicket.summary,
        description: state.jiraTicket.description,
        acceptanceCriteria: state.jiraTicket.acceptanceCriteria.join("\n"),
        priority: state.jiraTicket.priority,
        labels: state.jiraTicket.labels.join(", "),
        components: state.jiraTicket.components.join(", "),
        figmaUrl: state.figmaUrl ?? "None provided",
        additionalContext: contextSection,
      }) as BAOutput;

      emitAgentEvent(state.runId, {
        type: "agent:completed",
        agentId: "business-analyst",
        summary: result.summary,
        durationMs: Date.now() - start,
      });

      return {
        baOutput: result,
        requiresDevOps: result.requiresDevOps,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      emitAgentEvent(state.runId, { type: "agent:error", agentId: "business-analyst", error });
      return { error, status: "failed" };
    }
  };
}
