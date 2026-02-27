import * as vscode from "vscode";
import * as http from "http";

export class NovaflowPanel {
  public static currentPanel: NovaflowPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _port: number;

  public static createOrShow(extensionUri: vscode.Uri, port: number): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (NovaflowPanel.currentPanel) {
      NovaflowPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "novaflowPanel",
      "Novaflow",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        // CRITICAL: prevents Socket.io connection + React state from being
        // destroyed when the user switches editor tabs
        retainContextWhenHidden: true,
        portMapping: [
          {
            extensionHostPort: port,
            webviewPort: port,
          },
        ],
      }
    );

    NovaflowPanel.currentPanel = new NovaflowPanel(panel, extensionUri, port);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    _extensionUri: vscode.Uri,
    port: number
  ) {
    this._panel = panel;
    this._port = port;

    this._panel.webview.html = this._getHtml();

    this._panel.onDidDispose(() => {
      NovaflowPanel.currentPanel = undefined;
    });
  }

  private _getHtml(): string {
    const port = this._port;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             frame-src http://localhost:${port};
             script-src 'unsafe-inline';
             style-src 'unsafe-inline';">
  <title>Novaflow</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body, html {
      width: 100%; height: 100vh;
      background: #0d0d0d;
      display: flex;
      flex-direction: column;
    }
    #server-check {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      gap: 16px;
      color: #888;
      font-family: -apple-system, sans-serif;
    }
    #server-check h2 { color: #e8e8e8; font-size: 18px; }
    #server-check p { font-size: 13px; color: #666; }
    #server-check code {
      background: #1a1a1a;
      border: 1px solid #2e2e2e;
      border-radius: 4px;
      padding: 2px 6px;
      font-family: monospace;
      color: #7c6af7;
    }
    iframe {
      width: 100%;
      flex: 1;
      border: none;
      display: none;
    }
  </style>
</head>
<body>
  <div id="server-check">
    <h2>Novaflow</h2>
    <p>Connecting to local server on port <code>${port}</code>...</p>
    <p id="status-msg">Checking server status...</p>
  </div>
  <iframe id="app-frame" src="http://localhost:${port}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"></iframe>

  <script>
    const frame = document.getElementById('app-frame');
    const checkDiv = document.getElementById('server-check');
    const statusMsg = document.getElementById('status-msg');

    let attempts = 0;
    const MAX_ATTEMPTS = 30;

    function checkServer() {
      fetch('http://localhost:${port}/api/health')
        .then(r => {
          if (r.ok || r.status < 500) {
            // Server is up — show the iframe
            checkDiv.style.display = 'none';
            frame.style.display = 'block';
          } else {
            retryOrFail();
          }
        })
        .catch(() => retryOrFail());
    }

    function retryOrFail() {
      attempts++;
      if (attempts >= MAX_ATTEMPTS) {
        statusMsg.textContent = 'Could not connect. Run: npx novaflow start';
        return;
      }
      statusMsg.textContent = 'Waiting for server... (' + attempts + '/' + MAX_ATTEMPTS + ')';
      setTimeout(checkServer, 2000);
    }

    checkServer();
  </script>
</body>
</html>`;
  }
}
