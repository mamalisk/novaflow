import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { startRun, getCompiledGraph } from "@novaflow/agents";

export async function POST(req: NextRequest) {
  try {
    // Verify the agent graph is ready before accepting the run
    try {
      getCompiledGraph();
    } catch {
      return NextResponse.json(
        { error: "Agents not initialized. Check connection status at /api/status and restart the server." },
        { status: 503 }
      );
    }

    const body = await req.json() as { jiraTicketId?: string; figmaUrl?: string };
    const { jiraTicketId, figmaUrl } = body;

    if (!jiraTicketId) {
      return NextResponse.json({ error: "jiraTicketId is required" }, { status: 400 });
    }

    const runId = randomUUID();
    void startRun({ runId, jiraTicketId, figmaUrl });

    return NextResponse.json({ runId });
  } catch (error) {
    console.error("[api/run] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
