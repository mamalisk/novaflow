import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { emitAgentEvent } from "../graph/event-bus.js";
import type { NovaflowStateType, DevOpsOutput, FileChange } from "../graph/state.js";

const DevOpsSchema = z.object({
  changes: z.array(
    z.object({
      path: z.string(),
      action: z.enum(["create", "modify"]),
      content: z.string(),
      reasoning: z.string(),
    })
  ),
  summary: z.string(),
});

const DEVOPS_SYSTEM_PROMPT = `You are a DevOps Engineer. Analyze the implementation changes and determine if CI/CD pipeline modifications are needed.
Update GitLab CI/CD YAML files or other pipeline configuration as needed.
Be conservative — only change what is strictly necessary.`;

export function createDevOpsNode(llm: BaseChatModel) {
  return async function devopsNode(
    state: NovaflowStateType
  ): Promise<Partial<NovaflowStateType>> {
    const start = Date.now();

    emitAgentEvent(state.runId, {
      type: "agent:started",
      agentId: "devops",
      timestamp: new Date().toISOString(),
    });

    emitAgentEvent(state.runId, {
      type: "agent:thinking",
      agentId: "devops",
      message: "Checking if pipeline changes are needed...",
    });

    try {
      const prompt = ChatPromptTemplate.fromMessages([
        ["system", DEVOPS_SYSTEM_PROMPT],
        [
          "human",
          `Implementation summary: {summary}
Changed files: {changedFiles}
BA noted DevOps requirement: {requiresDevOps}{additionalContext}

Review and provide any necessary pipeline changes.`,
        ],
      ]);

      const chain = prompt.pipe(llm.withStructuredOutput(DevOpsSchema));

      const result = await chain.invoke({
        summary: state.implementationOutput?.summary ?? "",
        changedFiles: state.implementationOutput?.changes.map((c) => c.path).join(", ") ?? "",
        requiresDevOps: String(state.requiresDevOps),
        additionalContext: state.additionalContext
          ? `\n\nAdditional Specifications:\n${state.additionalContext}`
          : "",
      }) as z.infer<typeof DevOpsSchema>;

      const fileChanges: FileChange[] = [];
      for (const change of result.changes) {
        const dir = dirname(change.path);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(change.path, change.content, "utf-8");
        fileChanges.push({ path: change.path, action: change.action, content: change.content });

        emitAgentEvent(state.runId, {
          type: "file:changed",
          path: change.path,
          diff: "(pipeline change)",
        });
      }

      emitAgentEvent(state.runId, {
        type: "agent:completed",
        agentId: "devops",
        summary: result.summary || "No pipeline changes needed",
        durationMs: Date.now() - start,
      });

      return { devopsOutput: { pipelineChanges: fileChanges, summary: result.summary } };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      emitAgentEvent(state.runId, { type: "agent:error", agentId: "devops", error });
      return { error, status: "failed" };
    }
  };
}
