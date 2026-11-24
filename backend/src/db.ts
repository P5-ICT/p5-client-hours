import pg from "pg";

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

/**
 * The only database surface the app uses. Production runs on `pg`;
 * tests run the same SQL on PGlite (real Postgres compiled to WASM).
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Run several statements without parameters (used for migrations). */
  exec(text: string): Promise<void>;
  /** Run `fn` inside one transaction. Rolls back if it throws. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function fromClient(client: pg.PoolClient | pg.Pool): Db {
  return {
    async query<T>(text: string, params?: unknown[]) {
      const r = await client.query(text, params as unknown[]);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
    },
    async exec(text) {
      await client.query(text);
    },
    async tx() {
      throw new Error("Nested transactions are not supported");
    },
    async close() {},
  };
}

export function createPgDb(connectionString: string, ssl: boolean): Db {
  const pool = new pg.Pool({ connectionString, ssl: ssl ? { rejectUnauthorized: false } : undefined, max: 10 });
  const base = fromClient(pool);
  return {
    ...base,
    async tx<T>(fn: (db: Db) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const out = await fn(fromClient(client));
        await client.query("commit");
        return out;
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
