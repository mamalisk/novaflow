import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
} from "@langchain/langgraph";
// TASKS is not re-exported from the main index — import from constants subpath
const TASKS = "__pregel_tasks";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { RunnableConfig } from "@langchain/core/runnables";
// sql.js type — imported at runtime via initSqlJs()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlJs = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Database = any;

/**
 * A LangGraph checkpoint saver backed by sql.js (pure WASM SQLite).
 * No native binaries — safe to bundle in a .vsix.
 *
 * Schema mirrors SqliteSaver from @langchain/langgraph-checkpoint-sqlite so
 * the same thread state format is used.
 */
export class SqlJsCheckpointer extends BaseCheckpointSaver {
  private db: Database;
  private dbPath: string;

  private constructor(db: Database, dbPath: string) {
    super();
    this.db = db;
    this.dbPath = dbPath;
  }

  static async create(dbPath: string, wasmPath: string): Promise<SqlJsCheckpointer> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const initSqlJs: (opts: { locateFile: (f: string) => string }) => Promise<SqlJs> =
      // Dynamic require — esbuild will handle the bundling correctly for CJS output
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import("sql.js" as any)).default ?? (await import("sql.js" as any));

    const SQL: SqlJs = await initSqlJs({ locateFile: () => wasmPath });

    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const data = existsSync(dbPath) ? readFileSync(dbPath) : null;
    const db: Database = data ? new SQL.Database(data) : new SQL.Database();

    const saver = new SqlJsCheckpointer(db, dbPath);
    saver.setup();
    return saver;
  }

  private setup(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        type TEXT,
        checkpoint BLOB,
        metadata BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      );
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS checkpoint_blobs (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        channel TEXT NOT NULL,
        version TEXT NOT NULL,
        type TEXT NOT NULL,
        blob BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
      );
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS checkpoint_writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        type TEXT,
        blob BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      );
    `);
    this.persist();
  }

  private persist(): void {
    const data: Uint8Array = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;

    if (!threadId) return undefined;

    let stmt: Database;
    let rows: Array<{ values: unknown[][] }>;

    if (checkpointId) {
      stmt = this.db.prepare(`
        SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
        FROM checkpoints
        WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
      `);
      rows = stmt.getAsObject ? [{ values: [] }] : [];
      stmt.bind([threadId, checkpointNs, checkpointId]);
    } else {
      stmt = this.db.prepare(`
        SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
        FROM checkpoints
        WHERE thread_id = ? AND checkpoint_ns = ?
        ORDER BY checkpoint_id DESC LIMIT 1
      `);
      stmt.bind([threadId, checkpointNs]);
    }

    const row = stmt.getAsObject({});
    stmt.free();

    if (!row.checkpoint_id) return undefined;

    const checkpoint = JSON.parse(
      Buffer.from(row.checkpoint as Uint8Array).toString("utf-8")
    ) as Checkpoint;
    const metadata = JSON.parse(
      Buffer.from(row.metadata as Uint8Array).toString("utf-8")
    ) as CheckpointMetadata;

    // Load pending writes for this checkpoint
    const writesStmt = this.db.prepare(`
      SELECT task_id, channel, type, blob
      FROM checkpoint_writes
      WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
      ORDER BY idx
    `);
    writesStmt.bind([threadId, checkpointNs, row.checkpoint_id]);
    const pendingWrites: PendingWrite[] = [];
    while (writesStmt.step()) {
      const w = writesStmt.getAsObject({});
      const value =
        (w.type as string) === "msgpack"
          ? Buffer.from(w.blob as Uint8Array)
          : JSON.parse(Buffer.from(w.blob as Uint8Array).toString("utf-8"));
      pendingWrites.push([w.task_id as string, w.channel as string, value]);
    }
    writesStmt.free();

    const parentConfig =
      row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: checkpointNs,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined;

    return {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: row.checkpoint_id,
        },
      },
      checkpoint,
      metadata,
      parentConfig,
      pendingWrites,
    };
  }

  async *list(
    config: RunnableConfig,
    options?: { limit?: number; before?: RunnableConfig }
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    if (!threadId) return;

    let sql = `
      SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
      FROM checkpoints
      WHERE thread_id = ? AND checkpoint_ns = ?
    `;
    const params: unknown[] = [threadId, checkpointNs];

    if (options?.before?.configurable?.checkpoint_id) {
      sql += ` AND checkpoint_id < ?`;
      params.push(options.before.configurable.checkpoint_id);
    }
    sql += ` ORDER BY checkpoint_id DESC`;
    if (options?.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    while (stmt.step()) {
      const row = stmt.getAsObject({});
      const checkpoint = JSON.parse(
        Buffer.from(row.checkpoint as Uint8Array).toString("utf-8")
      ) as Checkpoint;
      const metadata = JSON.parse(
        Buffer.from(row.metadata as Uint8Array).toString("utf-8")
      ) as CheckpointMetadata;
      yield {
        config: {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: row.checkpoint_id,
          },
        },
        checkpoint,
        metadata,
        parentConfig: row.parent_checkpoint_id
          ? {
              configurable: {
                thread_id: threadId,
                checkpoint_ns: checkpointNs,
                checkpoint_id: row.parent_checkpoint_id,
              },
            }
          : undefined,
        pendingWrites: [],
      };
    }
    stmt.free();
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const parentCheckpointId = config.configurable?.checkpoint_id as string | undefined;
    const checkpointId = checkpoint.id;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO checkpoints
        (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run([
      threadId,
      checkpointNs,
      checkpointId,
      parentCheckpointId ?? null,
      "json",
      Buffer.from(JSON.stringify(checkpoint)),
      Buffer.from(JSON.stringify(metadata)),
    ]);
    stmt.free();
    this.persist();

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = config.configurable?.checkpoint_id as string;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO checkpoint_writes
        (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < writes.length; i++) {
      const [channel, value] = writes[i] as [string, unknown];
      stmt.run([
        threadId,
        checkpointNs,
        checkpointId,
        taskId,
        i,
        channel,
        channel === TASKS ? "msgpack" : "json",
        Buffer.from(
          channel === TASKS
            ? (value as Buffer)
            : JSON.stringify(value)
        ),
      ]);
    }
    stmt.free();
    this.persist();
  }
}
