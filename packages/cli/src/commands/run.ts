import chalk from "chalk";
import ora from "ora";
import { readGlobalConfig, readProjectConfig } from "../utils/config.js";

export interface RunOptions {
  ticket: string;
  figma?: string;
}

export async function runHeadless(options: RunOptions): Promise<void> {
  const globalConfig = readGlobalConfig();
  if (!globalConfig) {
    console.error(chalk.red("  No config found. Run `npx novaflow init` first.\n"));
    process.exit(1);
  }

  const port = globalConfig.server.port;
  const spinner = ora(`Triggering run for ticket ${options.ticket}...`).start();

  try {
    const body: Record<string, string> = { jiraTicketId: options.ticket };
    if (options.figma) body.figmaUrl = options.figma;

    const res = await fetch(`http://localhost:${port}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Server responded with ${res.status}`);
    }

    const { runId } = (await res.json()) as { runId: string };
    spinner.succeed(`Run started: ${chalk.cyan(runId)}`);
    console.log(chalk.dim(`  View progress at: http://localhost:${port}/run/${runId}\n`));
  } catch (error) {
    spinner.fail("Failed to trigger run.");
    console.error(chalk.red(`  Is the Novaflow server running? (npx novaflow start)\n`));
    console.error(chalk.dim(String(error)));
    process.exit(1);
  }
}
