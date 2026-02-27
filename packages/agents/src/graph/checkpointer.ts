import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";

let checkpointerInstance: SqliteSaver | null = null;

export function getCheckpointer(): SqliteSaver {
  if (checkpointerInstance) return checkpointerInstance;

  const dir = join(homedir(), ".novaflow");
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, ".novaflow-sqlite");

  checkpointerInstance = SqliteSaver.fromConnString(dbPath);
  return checkpointerInstance;
}
