import * as vscode from "vscode";
import { NovaflowPanel } from "./panel.js";
import { NovaflowRunner } from "./runner.js";

let runner: NovaflowRunner | undefined;

export function activate(context: vscode.ExtensionContext): void {
  runner = new NovaflowRunner(context);

  // Initialize the graph (async — panel still opens even if this fails)
  void runner.initialize();

  // Command: Open Novaflow panel
  context.subscriptions.push(
    vscode.commands.registerCommand("novaflow.open", () => {
      NovaflowPanel.createOrShow(context.extensionUri, runner!);
    })
  );

  // Command: Configure API keys via SecretStorage
  context.subscriptions.push(
    vscode.commands.registerCommand("novaflow.configure", async () => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: "AI API Key", key: "novaflow.ai.apiKey", description: "Anthropic / OpenAI / Azure key" },
          { label: "JIRA API Token", key: "novaflow.jira.apiToken", description: "Atlassian API token" },
          { label: "GitLab Access Token", key: "novaflow.gitlab.token", description: "GitLab personal access token" },
        ],
        { placeHolder: "What would you like to configure?" }
      );
      if (!choice) return;

      const value = await vscode.window.showInputBox({
        prompt: `Enter ${choice.label}`,
        password: true,
        ignoreFocusOut: true,
      });
      if (value === undefined) return;

      await context.secrets.store(choice.key, value);
      vscode.window.showInformationMessage(`Novaflow: ${choice.label} saved.`);

      // Re-initialize graph with new credentials
      void runner!.initialize();
    })
  );

  // Status bar item
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = "$(robot) Novaflow";
  statusBar.tooltip = "Open Novaflow";
  statusBar.command = "novaflow.open";
  statusBar.show();
  context.subscriptions.push(statusBar);
}

export function deactivate(): void {
  // Panel disposes itself; runner has no long-lived resources to clean up
}
