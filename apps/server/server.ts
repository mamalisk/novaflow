/**
 * Custom Next.js server entry point.
 * This attaches Socket.io to the same http.Server as Next.js,
 * allowing both to share a single port.
 *
 * Run with: node --loader ts-node/esm server.ts (dev)
 *       or: node server.js (after tsc build)
 */
import { createServer } from "http";
import { parse } from "url";
import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { initSocketServer } from "./src/lib/socket-server.js";
import { initAgents } from "@novaflow/agents";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  NovaflowConfig,
  NovaflowProjectConfig,
} from "@novaflow/shared-types";

// Global slot for loaded config — shared across all module instances via Node.js global
declare global {
  // eslint-disable-next-line no-var
  var __novaflowLoadedConfig: { global: NovaflowConfig; project: NovaflowProjectConfig } | undefined;
}

const port = parseInt(process.env.NOVAFLOW_PORT ?? "3847", 10);
const host = process.env.NOVAFLOW_HOST ?? "localhost";
const dev = process.env.NODE_ENV !== "production";

// Pin the user's project root to an env var so Next.js API route handlers
// (which run with cwd = apps/server/) can resolve .novaflow/ paths correctly.
// Only set once — the CLI may have already provided it via NOVAFLOW_PROJECT_DIR.
if (!process.env.NOVAFLOW_PROJECT_DIR) {
  process.env.NOVAFLOW_PROJECT_DIR = process.cwd();
}

const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => {
  const parsedUrl = parse(req.url ?? "/", true);
  handle(req, res, parsedUrl);
});

// Attach Socket.io to the same httpServer
const io = new SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: {
    // Allow VS Code webview origins (vscode-webview://*) and localhost
    origin: ["http://localhost:*", "vscode-webview://*", "*"],
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});

initSocketServer(io);

// Initialize agents from config files
const globalConfigPath = join(homedir(), ".novaflow", "config.json");
const projectConfigPath = join(process.env.NOVAFLOW_PROJECT_DIR!, ".novaflow", "project.json");

if (existsSync(globalConfigPath) && existsSync(projectConfigPath)) {
  try {
    const globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf-8")) as NovaflowConfig;
    const projectConfig = JSON.parse(readFileSync(projectConfigPath, "utf-8")) as NovaflowProjectConfig;

    // Store config globally so /api/status can read it without re-parsing files
    global.__novaflowLoadedConfig = { global: globalConfig, project: projectConfig };

    await initAgents(globalConfig, projectConfig);
    console.log("  ✓ Agents initialized.\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ Agent initialization failed: ${msg}`);
    console.error("  Check your config (run `npx novaflow init`) and restart.\n");
    // Server still starts — /api/status will report what's wrong
  }
} else {
  console.warn("  ⚠ Config files not found. Run `npx novaflow init` first.\n");
}

httpServer.listen(port, host, () => {
  console.log(`\n  Novaflow server running at http://${host}:${port}\n`);
});
