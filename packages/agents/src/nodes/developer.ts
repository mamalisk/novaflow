import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { interrupt } from "@langchain/langgraph";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { emitAgentEvent } from "../graph/event-bus.js";
import type { NovaflowStateType, FileChange, ImplementationOutput } from "../graph/state.js";
import type { NovaflowProjectConfig } from "@novaflow/shared-types";

const ImplementationSchema = z.object({
  changes: z.array(
    z.object({
      path: z.string().describe("File path relative to project root"),
      action: z.enum(["create", "modify", "delete"]),
      content: z.string().describe("Full file content (for create/modify)"),
      reasoning: z.string().describe("Why this change is needed"),
    })
  ),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  uncertainties: z.array(z.string()),
});

const DEVELOPER_SYSTEM_PROMPT = `You are a Senior Software Engineer. Implement the required changes based on the business analysis and test plan.
- Follow the project's coding conventions and architecture patterns
- Write clean, maintainable code
- Make minimal changes — only what is necessary to satisfy the acceptance criteria
- If you are uncertain about something, list it in the uncertainties field`;

export function createDeveloperNode(
  llm: BaseChatModel,
  projectConfig: NovaflowProjectConfig
) {
  return async function developerNode(
    state: NovaflowStateType
  ): Promise<Partial<NovaflowStateType>> {
    const start = Date.now();

    emitAgentEvent(state.runId, {
      type: "agent:started",
      agentId: "developer",
      timestamp: new Date().toISOString(),
    });

    if (!state.baOutput || !state.testPlanOutput) {
      const error = "Missing business analysis or test plan";
      emitAgentEvent(state.runId, { type: "agent:error", agentId: "developer", error });
      return { error, status: "failed" };
    }

    emitAgentEvent(state.runId, {
      type: "agent:thinking",
      agentId: "developer",
      message: "Planning implementation...",
    });

    try {
      const prompt = ChatPromptTemplate.fromMessages([
        ["system", DEVELOPER_SYSTEM_PROMPT],
        [
          "human",
          `Implement the following:

Business Analysis:
{summary}

Acceptance Criteria:
{acceptanceCriteria}

Affected Components:
{affectedComponents}

Automated Tests to Pass:
{automatedTests}{additionalContext}

Provide the complete implementation.`,
        ],
      ]);

      const chain = prompt.pipe(llm.withStructuredOutput(ImplementationSchema));

      const result = await chain.invoke({
        summary: state.baOutput.summary,
        acceptanceCriteria: state.baOutput.acceptanceCriteria.join("\n"),
        affectedComponents: state.baOutput.affectedComponents.join(", "),
        automatedTests: state.testPlanOutput.automatedTests
          .map((t) => `- ${t.name}: ${t.description}`)
          .join("\n"),
        additionalContext: state.additionalContext
          ? `\n\nAdditional Specifications:\n${state.additionalContext}`
          : "",
      }) as z.infer<typeof ImplementationSchema>;

      // If agent is uncertain AND the project allows uncertainty pauses, interrupt
      if (
        result.confidence < 0.7 &&
        projectConfig.permissions.allowAgentUncertaintyPause &&
        result.uncertainties.length > 0
      ) {
        emitAgentEvent(state.runId, {
          type: "checkpoint:required",
          gate: "agent-uncertainty",
          agentId: "developer",
          payload: {
            uncertainties: result.uncertainties,
            proposedChanges: result.changes.map((c) => ({ path: c.path, action: c.action })),
          },
        });

        const humanGuidance = interrupt({
          gate: "agent-uncertainty",
          agentId: "developer",
          uncertainties: result.uncertainties,
          proposal: result.summary,
        }) as { action: "approved" | "rejected"; guidance?: string };

        if (humanGuidance.action === "rejected") {
          return { status: "cancelled" as const };
        }
        // If approved, proceed with the implementation as-is
      }

      // Write files to disk
      const fileChanges: FileChange[] = [];
      for (const change of result.changes) {
        if (change.action === "delete") {
          // Soft delete: just record it, don't actually delete until commit approved
          fileChanges.push({ path: change.path, action: "delete" });
        } else {
          // Write file
          const fullPath = change.path;
          const dir = dirname(fullPath);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

          const existing = existsSync(fullPath) ? readFileSync(fullPath, "utf-8") : null;
          writeFileSync(fullPath, change.content, "utf-8");

          fileChanges.push({
            path: change.path,
            action: existing ? "modify" : "create",
            content: change.content,
            diff: existing ? generateSimpleDiff(existing, change.content) : undefined,
          });

          emitAgentEvent(state.runId, {
            type: "file:changed",
            path: change.path,
            diff: existing ? generateSimpleDiff(existing, change.content) : "(new file)",
          });
        }
      }

      const branchName = `${projectConfig.gitlab.branchPrefix}${state.jiraTicketId}-${state.runId.slice(0, 8)}`;

      emitAgentEvent(state.runId, {
        type: "agent:completed",
        agentId: "developer",
        summary: `${fileChanges.length} files changed: ${result.summary}`,
        durationMs: Date.now() - start,
      });

      return {
        implementationOutput: {
          changes: fileChanges,
          summary: result.summary,
          branchName,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      emitAgentEvent(state.runId, { type: "agent:error", agentId: "developer", error });
      return { error, status: "failed" };
    }
  };
}

function generateSimpleDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const diff: string[] = [];

  const maxLen = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (i >= beforeLines.length) {
      diff.push(`+ ${afterLines[i]}`);
    } else if (i >= afterLines.length) {
      diff.push(`- ${beforeLines[i]}`);
    } else if (beforeLines[i] !== afterLines[i]) {
      diff.push(`- ${beforeLines[i]}`);
      diff.push(`+ ${afterLines[i]}`);
    }
  }

  return diff.slice(0, 100).join("\n"); // cap at 100 lines for event payload
}
