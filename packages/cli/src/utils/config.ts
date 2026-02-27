import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { NovaflowConfig, NovaflowProjectConfig } from "@novaflow/shared-types";

export const GLOBAL_CONFIG_DIR = join(homedir(), ".novaflow");
export const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, "config.json");
export const PROJECT_CONFIG_DIR = ".novaflow";
export const PROJECT_CONFIG_PATH = join(PROJECT_CONFIG_DIR, "project.json");

export function readGlobalConfig(): NovaflowConfig | null {
  if (!existsSync(GLOBAL_CONFIG_PATH)) return null;
  return JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, "utf-8")) as NovaflowConfig;
}

export function writeGlobalConfig(config: NovaflowConfig): void {
  mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function readProjectConfig(): NovaflowProjectConfig | null {
  if (!existsSync(PROJECT_CONFIG_PATH)) return null;
  return JSON.parse(readFileSync(PROJECT_CONFIG_PATH, "utf-8")) as NovaflowProjectConfig;
}

export function writeProjectConfig(config: NovaflowProjectConfig): void {
  mkdirSync(PROJECT_CONFIG_DIR, { recursive: true });
  writeFileSync(PROJECT_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function ensureKnowledgeDir(): void {
  mkdirSync(join(PROJECT_CONFIG_DIR, "knowledge"), { recursive: true });
}
