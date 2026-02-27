import { select, input, password, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import {
  defaultNovaflowConfig,
  defaultProjectConfig,
  type AIProvider,
} from "@novaflow/shared-types";
import {
  writeGlobalConfig,
  writeProjectConfig,
  ensureKnowledgeDir,
  readGlobalConfig,
  readProjectConfig,
} from "../utils/config.js";

export async function runInit(): Promise<void> {
  console.log(chalk.cyan("\n  Novaflow Setup Wizard\n"));

  const existingGlobal = readGlobalConfig();
  const existingProject = readProjectConfig();

  if (existingGlobal || existingProject) {
    const overwrite = await confirm({
      message: "Novaflow config already exists. Overwrite?",
      default: false,
    });
    if (!overwrite) {
      console.log(chalk.yellow("Setup cancelled."));
      return;
    }
  }

  // ─── AI Provider ───────────────────────────────────────────────────────────
  console.log(chalk.bold("\n  Step 1: AI Provider\n"));

  const provider = await select<AIProvider>({
    message: "Select your AI provider:",
    choices: [
      { name: "Anthropic (Claude)", value: "anthropic" },
      { name: "OpenAI (GPT)", value: "openai" },
      { name: "Azure OpenAI", value: "azure-openai" },
      { name: "Ollama (local, free)", value: "ollama" },
    ],
  });

  const defaultModel =
    provider === "anthropic"
      ? "claude-opus-4-6"
      : provider === "openai"
        ? "gpt-4o"
        : provider === "azure-openai"
          ? "gpt-4o"
          : "qwen2.5-coder:32b";

  const model = await input({
    message: "Model name:",
    default: defaultModel,
  });

  const apiKey =
    provider !== "ollama"
      ? await password({ message: "API Key:" })
      : "";

  const baseUrl =
    provider === "azure-openai"
      ? await input({ message: "Azure OpenAI base URL:" })
      : provider === "ollama"
        ? await input({ message: "Ollama URL:", default: "http://localhost:11434" })
        : undefined;

  // ─── Server ────────────────────────────────────────────────────────────────
  const port = await input({
    message: "Local server port:",
    default: "3847",
  });

  // ─── ChromaDB ──────────────────────────────────────────────────────────────
  console.log(chalk.bold("\n  Step 2: ChromaDB (vector store)\n"));
  const chromaHost = await input({ message: "ChromaDB host:", default: "localhost" });
  const chromaPort = await input({ message: "ChromaDB port:", default: "8000" });

  // ─── Checkpoints ───────────────────────────────────────────────────────────
  console.log(chalk.bold("\n  Step 3: Approval Checkpoints\n"));
  const checkAfterBA = await confirm({
    message: "Pause for review after Business Analysis?",
    default: true,
  });
  const checkBeforeImpl = await confirm({
    message: "Pause for review before Implementation?",
    default: true,
  });
  const checkBeforeCommit = await confirm({
    message: "Pause for review before Committing?",
    default: true,
  });
  const allowUncertainty = await confirm({
    message: "Allow agents to pause and ask when uncertain?",
    default: true,
  });

  // ─── JIRA ──────────────────────────────────────────────────────────────────
  console.log(chalk.bold("\n  Step 4: JIRA\n"));
  const jiraUrl = await input({ message: "JIRA base URL (e.g. https://myco.atlassian.net):" });
  const jiraEmail = await input({ message: "JIRA email:" });
  const jiraToken = await password({ message: "JIRA API token:" });
  const jiraProject = await input({ message: "Default JIRA project key (e.g. PROJ):" });

  // ─── GitLab ────────────────────────────────────────────────────────────────
  console.log(chalk.bold("\n  Step 5: GitLab\n"));
  const gitlabUrl = await input({ message: "GitLab base URL:", default: "https://gitlab.com" });
  const gitlabToken = await password({ message: "GitLab personal access token:" });
  const gitlabProjectId = await input({ message: "GitLab project ID or path:" });
  const gitlabBranch = await input({ message: "Default branch:", default: "main" });

  // ─── Figma (optional) ──────────────────────────────────────────────────────
  console.log(chalk.bold("\n  Step 6: Figma (optional)\n"));
  const hasFigma = await confirm({ message: "Do you use Figma?", default: false });
  const figmaToken = hasFigma ? await password({ message: "Figma access token:" }) : undefined;

  // ─── Project name ──────────────────────────────────────────────────────────
  const projectName = await input({
    message: "Project name:",
    default: process.cwd().split(/[\\/]/).pop() ?? "my-project",
  });

  // ─── Write configs ─────────────────────────────────────────────────────────
  const globalConfig = defaultNovaflowConfig();
  globalConfig.ai = { provider, model, apiKey: apiKey || "", temperature: 0.2 };
  if (baseUrl) globalConfig.ai.baseUrl = baseUrl;
  globalConfig.server.port = parseInt(port, 10);
  globalConfig.chromadb.host = chromaHost;
  globalConfig.chromadb.port = parseInt(chromaPort, 10);

  const projectConfig = defaultProjectConfig(projectName);
  projectConfig.jira = { baseUrl: jiraUrl, email: jiraEmail, apiToken: jiraToken, defaultProject: jiraProject };
  projectConfig.gitlab = {
    baseUrl: gitlabUrl,
    personalAccessToken: gitlabToken,
    projectId: gitlabProjectId,
    defaultBranch: gitlabBranch,
    branchPrefix: "novaflow/",
    commitMessageTemplate: "{ticketId}: {summary}",
  };
  if (figmaToken) projectConfig.figma = { accessToken: figmaToken };
  projectConfig.permissions = {
    checkpoints: {
      afterBusinessAnalysis: checkAfterBA,
      beforeImplementation: checkBeforeImpl,
      beforeCommit: checkBeforeCommit,
    },
    allowAgentUncertaintyPause: allowUncertainty,
  };

  writeGlobalConfig(globalConfig);
  writeProjectConfig(projectConfig);
  ensureKnowledgeDir();

  console.log(chalk.green("\n  Novaflow initialized successfully!\n"));
  console.log(`  Global config: ${chalk.dim("~/.novaflow/config.json")}`);
  console.log(`  Project config: ${chalk.dim(".novaflow/project.json")}`);
  console.log(`  Knowledge dir:  ${chalk.dim(".novaflow/knowledge/")}\n`);
  console.log(chalk.cyan("  Run `npx novaflow start` to launch the server.\n"));
}
