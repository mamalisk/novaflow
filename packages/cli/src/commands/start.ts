import { execa } from "execa";
import chalk from "chalk";
import ora from "ora";
import { readGlobalConfig, readProjectConfig } from "../utils/config.js";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

export async function runStart(): Promise<void> {
  const globalConfig = readGlobalConfig();
  if (!globalConfig) {
    console.error(chalk.red("  No config found. Run `npx novaflow init` first.\n"));
    process.exit(1);
  }

  const projectConfig = readProjectConfig();
  if (!projectConfig) {
    console.warn(chalk.yellow("  No project config found (.novaflow/project.json). Some features will be disabled.\n"));
  }

  const port = globalConfig.server.port;
  const spinner = ora(`Starting Novaflow server on port ${port}...`).start();

  // Find the server package relative to this package
  // In production (npx), this resolves from node_modules
  // In monorepo dev, it resolves from apps/server
  // __dirname = packages/cli/dist/commands/ — go up 4 levels to reach monorepo root
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const serverPath = resolve(__dirname, "../../../../apps/server");

  const monorepoRoot = resolve(__dirname, "../../../../../");
  const env = {
    ...process.env,
    NOVAFLOW_PORT: String(port),
    NOVAFLOW_HOST: globalConfig.server.host,
    // Pass the user's project directory so Next.js route handlers can resolve
    // .novaflow/ paths correctly regardless of which directory the server runs from.
    NOVAFLOW_PROJECT_DIR: process.cwd(),
  };

  spinner.succeed(chalk.green(`Novaflow server starting at http://localhost:${port}`));
  console.log(chalk.dim("  Press Ctrl+C to stop.\n"));

  try {
    await execa("pnpm", ["--filter", "@novaflow/server", "start"], {
      env,
      stdio: "inherit",
      cwd: monorepoRoot,
    });
  } catch {
    spinner.fail("Failed to start server.");
    console.error(chalk.red(`Could not start the Novaflow server from ${monorepoRoot}`));
    console.error(chalk.dim("  Is @novaflow/server installed? Try: pnpm install"));
    process.exit(1);
  }
}
