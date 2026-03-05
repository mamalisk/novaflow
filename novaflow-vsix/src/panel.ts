import * as vscode from "vscode";
import { NovaflowRunner } from "./runner.js";

/**
 * Manages the Novaflow WebviewPanel.
 * The panel renders the React UI (dist/webview.js) and communicates
 * with the extension host via postMessage instead of Socket.io.
 */
export class NovaflowPanel {
  public static current: NovaflowPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly runner: NovaflowRunner;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    runner: NovaflowRunner
  ): void {
    if (NovaflowPanel.current) {
      NovaflowPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "novaflow",
      "Novaflow",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      }
    );
    NovaflowPanel.current = new NovaflowPanel(panel, extensionUri, runner);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    runner: NovaflowRunner
  ) {
    this.panel = panel;
    this.runner = runner;
    this.runner.setPanel(panel);

    this.panel.webview.html = this.getHtml(extensionUri);

    // Inbound messages from webview
    this.panel.webview.onDidReceiveMessage(
      (msg: Record<string, unknown>) => { void runner.handleMessage(msg); },
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Send initial status as soon as panel is ready
    setTimeout(() => {
      const status = runner.getStatus();
      panel.webview.postMessage({ type: "status:update", status });
    }, 300);
  }

  private getHtml(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "webview.js")
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; font-src data:;" />
  <title>Novaflow</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d0d0d;
      color: #e0e0e0;
      font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
      font-size: 13px;
      height: 100vh;
      overflow: hidden;
    }
    #root { height: 100vh; display: flex; flex-direction: column; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }

  public dispose(): void {
    NovaflowPanel.current = undefined;
    this.runner.clearPanel();
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
