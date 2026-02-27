import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do NOT bundle these packages — use Node.js native module cache instead.
  // This ensures API routes share the same singleton instances (compiled graph,
  // agentEventBus) that were initialized in server.ts at startup.
  serverExternalPackages: [
    "@novaflow/agents",
    "@novaflow/shared-types",
    "better-sqlite3",
    "@langchain/langgraph",
    "@langchain/langgraph-checkpoint-sqlite",
    "@langchain/core",
  ],
  // Custom server (server.ts) handles routing — standalone output not used
  // Allow the VS Code webview origin
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
        ],
      },
    ];
  },
};

export default nextConfig;
