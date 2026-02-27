import { emitAgentEvent } from "../graph/event-bus.js";
import type { NovaflowStateType, JiraTicket } from "../graph/state.js";
import type { NovaflowProjectConfig } from "@novaflow/shared-types";

export function createFetchJiraNode(projectConfig: NovaflowProjectConfig) {
  return async function fetchJiraNode(
    state: NovaflowStateType
  ): Promise<Partial<NovaflowStateType>> {
    const start = Date.now();

    emitAgentEvent(state.runId, {
      type: "agent:started",
      agentId: "fetch-jira",
      timestamp: new Date().toISOString(),
    });

    emitAgentEvent(state.runId, {
      type: "agent:thinking",
      agentId: "fetch-jira",
      message: `Fetching JIRA ticket ${state.jiraTicketId}...`,
    });

    try {
      const ticket = await fetchTicketFromJira(state.jiraTicketId, projectConfig);

      emitAgentEvent(state.runId, {
        type: "agent:completed",
        agentId: "fetch-jira",
        summary: `Fetched: ${ticket.summary}`,
        durationMs: Date.now() - start,
      });

      return { jiraTicket: ticket };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      emitAgentEvent(state.runId, { type: "agent:error", agentId: "fetch-jira", error });
      return { error, status: "failed" };
    }
  };
}

async function fetchTicketFromJira(
  ticketId: string,
  config: NovaflowProjectConfig
): Promise<JiraTicket> {
  const { baseUrl, email, apiToken } = config.jira;
  const credentials = Buffer.from(`${email}:${apiToken}`).toString("base64");

  const res = await fetch(`${baseUrl}/rest/api/3/issue/${ticketId}`, {
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`JIRA API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as {
    key: string;
    fields: {
      summary: string;
      description?: { content?: Array<{ content?: Array<{ text?: string }> }> };
      priority?: { name: string };
      labels?: string[];
      components?: Array<{ name: string }>;
    };
  };

  // Extract plain text from Atlassian Document Format (ADF)
  const description = extractTextFromADF(data.fields.description);

  // Extract acceptance criteria — commonly in a specific field or in description
  const acceptanceCriteria = extractAcceptanceCriteria(description);

  return {
    id: data.key,
    summary: data.fields.summary,
    description,
    acceptanceCriteria,
    priority: data.fields.priority?.name ?? "Medium",
    labels: data.fields.labels ?? [],
    components: data.fields.components?.map((c) => c.name) ?? [],
  };
}

function extractTextFromADF(
  adf?: { content?: Array<{ content?: Array<{ text?: string }> }> }
): string {
  if (!adf?.content) return "";
  return adf.content
    .flatMap((block) => block.content ?? [])
    .map((inline) => inline.text ?? "")
    .join(" ")
    .trim();
}

function extractAcceptanceCriteria(description: string): string[] {
  // Look for lines starting with "AC:", "Given", "When", "Then", or numbered list after "Acceptance Criteria"
  const lines = description.split("\n");
  const acSection: string[] = [];
  let inAC = false;

  for (const line of lines) {
    if (/acceptance criteria/i.test(line)) {
      inAC = true;
      continue;
    }
    if (inAC && line.trim()) {
      if (/^(given|when|then|and|but|\d+\.|[-*])/i.test(line.trim())) {
        acSection.push(line.trim());
      } else if (acSection.length > 0) {
        break; // end of AC section
      }
    }
  }

  return acSection;
}
