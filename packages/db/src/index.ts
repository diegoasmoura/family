import Database from 'better-sqlite3';
import pg from 'pg';

export type Dialect = 'sqlite' | 'pg';
export type Params = unknown[];

/**
 * Interface mínima e portável. As consultas usam `?` como placeholder;
 * o adaptador PostgreSQL converte para `$1, $2...`.
 */
export interface Db {
  dialect: Dialect;
  all<T = any>(sql: string, params?: Params): Promise<T[]>;
  get<T = any>(sql: string, params?: Params): Promise<T | undefined>;
  run(sql: string, params?: Params): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class Mutex {
  private last: Promise<void> = Promise.resolve();
  async lock(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.last;
    this.last = prev.then(() => next);
    await prev;
    return release;
  }
}

function sqliteDb(file: string): Db {
  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  // better-sqlite3 é síncrono e usa uma única conexão: uma transação precisa
  // impedir que outra requisição execute comandos entre o BEGIN e o COMMIT.
  const mutex = new Mutex();

  const raw = {
    all: (sql: string, params: Params = []) => conn.prepare(sql).all(...(params as any[])),
    get: (sql: string, params: Params = []) => conn.prepare(sql).get(...(params as any[])),
    run: (sql: string, params: Params = []) => {
      const stmt = conn.prepare(sql);
      if (stmt.reader) {
        stmt.all(...(params as any[]));
        return { changes: 0 };
      }
      return { changes: stmt.run(...(params as any[])).changes };
    },
  };

  const scoped: Db = {
    dialect: 'sqlite',
    all: async (sql, params) => raw.all(sql, params) as any,
    get: async (sql, params) => raw.get(sql, params) as any,
    run: async (sql, params) => raw.run(sql, params),
    exec: async (sql) => void conn.exec(sql),
    tx: async (fn) => fn(scoped),
    close: async () => undefined,
  };

  const locked = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const release = await mutex.lock();
    try {
      return await fn();
    } finally {
      release();
    }
  };

  return {
    dialect: 'sqlite',
    all: (sql, params) => locked(() => raw.all(sql, params) as any),
    get: (sql, params) => locked(() => raw.get(sql, params) as any),
    run: (sql, params) => locked(() => raw.run(sql, params)),
    exec: (sql) => locked(() => void conn.exec(sql)),
    tx: (fn) =>
      locked(async () => {
        conn.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(scoped);
          conn.exec('COMMIT');
          return result;
        } catch (err) {
          conn.exec('ROLLBACK');
          throw err;
        }
      }),
    close: async () => void conn.close(),
  };
}

function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// COUNT/SUM voltam como int8; para valores em centavos de um casal cabem em Number.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => Number(v));

function pgDb(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 10 });

  const fromClient = (client: pg.Pool | pg.PoolClient): Db => {
    const self: Db = {
      dialect: 'pg',
      all: async (sql, params = []) => (await client.query(toPg(sql), params as any[])).rows,
      get: async (sql, params = []) => (await client.query(toPg(sql), params as any[])).rows[0],
      run: async (sql, params = []) => ({ changes: (await client.query(toPg(sql), params as any[])).rowCount ?? 0 }),
      exec: async (sql) => void (await client.query(sql)),
      tx: async (fn) => {
        if (client !== pool) return fn(self);
        const conn = await pool.connect();
        try {
          await conn.query('BEGIN');
          const result = await fn(fromClient(conn));
          await conn.query('COMMIT');
          return result;
        } catch (err) {
          await conn.query('ROLLBACK');
          throw err;
        } finally {
          conn.release();
        }
      },
      close: async () => {
        if (client === pool) await pool.end();
      },
    };
    return self;
  };

  return fromClient(pool);
}

/**
 * DATABASE_URL:
 *   postgres://user:pass@host:5432/db  -> PostgreSQL
 *   sqlite:./data/financas.db | sqlite::memory: -> SQLite
 */
export function createDb(url: string): Db {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return pgDb(url);
  if (url.startsWith('sqlite:')) return sqliteDb(url.slice('sqlite:'.length) || ':memory:');
  throw new Error(`DATABASE_URL não suportada: ${url}`);
}

export { migrate } from './migrate';
