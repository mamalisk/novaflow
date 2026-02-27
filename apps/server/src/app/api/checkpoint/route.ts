import { NextRequest, NextResponse } from "next/server";
import type { CheckpointDecision } from "@novaflow/shared-types";
import { resumeRun } from "@novaflow/agents";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { runId?: string; decision?: CheckpointDecision };
    const { runId, decision } = body;

    if (!runId || !decision) {
      return NextResponse.json({ error: "runId and decision are required" }, { status: 400 });
    }

    void resumeRun(runId, decision);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/checkpoint] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
