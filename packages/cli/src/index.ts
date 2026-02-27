#!/usr/bin/env node
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runStart } from "./commands/start.js";
import { runHeadless } from "./commands/run.js";

const program = new Command();

program
  .name("novaflow")
  .description("AI-first development tool — from JIRA ticket to working code")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize Novaflow for this project")
  .action(async () => {
    await runInit();
  });

program
  .command("start")
  .description("Start the Novaflow local server")
  .action(async () => {
    await runStart();
  });

program
  .command("run")
  .description("Trigger a run headlessly (server must be running)")
  .requiredOption("-t, --ticket <ticketId>", "JIRA ticket ID (e.g. PROJ-123)")
  .option("-f, --figma <url>", "Figma file URL")
  .action(async (options: { ticket: string; figma?: string }) => {
    await runHeadless(options);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
