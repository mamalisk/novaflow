import { NextResponse } from "next/server";
import { checkIntegrations } from "@novaflow/agents";
import type { NovaflowConfig, NovaflowProjectConfig } from "@novaflow/shared-types";

declare global {
  // eslint-disable-next-line no-var
  var __novaflowLoadedConfig: { global: NovaflowConfig; project: NovaflowProjectConfig } | undefined;
}

const NOT_CONFIGURED = { ok: false, message: "Run `novaflow init` to configure" };

export async function GET() {
  const config = global.__novaflowLoadedConfig;

  if (!config) {
    return NextResponse.json({
      graphInitialized: false,
      ai: NOT_CONFIGURED,
      jira: NOT_CONFIGURED,
      gitlab: NOT_CONFIGURED,
      figma: { ok: true, message: "Not configured (optional)" },
    });
  }

  try {
    const result = await checkIntegrations(config.global, config.project);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
