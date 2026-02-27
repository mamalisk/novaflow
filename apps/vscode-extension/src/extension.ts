import * as vscode from "vscode";
import { NovaflowPanel } from "./panel.js";

export function activate(context: vscode.ExtensionContext): void {
  function getPort(): number {
    return vscode.workspace
      .getConfiguration("novaflow")
      .get<number>("serverPort", 3847);
  }

  // Command: Open Novaflow panel
  context.subscriptions.push(
    vscode.commands.registerCommand("novaflow.openPanel", () => {
      const port = getPort();
      NovaflowPanel.createOrShow(context.extensionUri, port);
    })
  );

  // Command: Start Novaflow server in a terminal
  context.subscriptions.push(
    vscode.commands.registerCommand("novaflow.startServer", () => {
      const terminal = vscode.window.createTerminal({
        name: "Novaflow",
        shellPath: undefined,
      });
      terminal.sendText("npx novaflow start");
      terminal.show();

      // Open the panel after a short delay to let the server boot
      setTimeout(() => {
        const port = getPort();
        NovaflowPanel.createOrShow(context.extensionUri, port);
      }, 3000);
    })
  );

  // Show status bar item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = "$(robot) Novaflow";
  statusBarItem.tooltip = "Open Novaflow";
  statusBarItem.command = "novaflow.openPanel";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

export function deactivate(): void {
  // Nothing to clean up — webview disposes itself
}
