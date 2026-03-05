import esbuild from "esbuild";
import { copyFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes("--watch");

// Ensure dist directory exists
if (!existsSync("dist")) mkdirSync("dist");

// Copy sql-wasm.wasm into dist
const wasmSrc = resolve(__dirname, "node_modules/sql.js/dist/sql-wasm.wasm");
copyFileSync(wasmSrc, "dist/sql-wasm.wasm");
console.log("Copied sql-wasm.wasm → dist/");

const sharedOptions = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch ? "inline" : false,
  logLevel: "info",
};

// ── Extension host bundle (Node.js / CJS) ────────────────────────────────────
const extensionCtx = await esbuild.context({
  ...sharedOptions,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  format: "cjs",
  platform: "node",
  target: "node18",
  external: ["vscode"],
  // sql.js loads its own WASM — tell esbuild not to bundle the wasm file
  loader: { ".wasm": "file" },
});

// ── Webview bundle (browser IIFE) ─────────────────────────────────────────────
const webviewCtx = await esbuild.context({
  ...sharedOptions,
  entryPoints: ["src/webview/index.tsx"],
  outfile: "dist/webview.js",
  format: "iife",
  platform: "browser",
  target: ["chrome114"],
  define: {
    "process.env.NODE_ENV": isWatch ? '"development"' : '"production"',
  },
});

if (isWatch) {
  await extensionCtx.watch();
  await webviewCtx.watch();
  console.log("Watching for changes...");
} else {
  await extensionCtx.rebuild();
  await webviewCtx.rebuild();
  await extensionCtx.dispose();
  await webviewCtx.dispose();
  console.log("Build complete.");
}
