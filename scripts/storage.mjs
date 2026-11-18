import { DatabaseSync } from "node:sqlite";
import {
  readFileSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
export function storage(root = ".runtime") {
  mkdirSync(root, { recursive: true });
  const conn = new DatabaseSync(join(root, "workspace.sqlite"));
  conn.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  conn.exec(
    "CREATE TABLE IF NOT EXISTS schema_versions(name TEXT PRIMARY KEY)",
  );
  for (const name of [
    "0000_workspace",
    "0001_suggestions",
    "0002_session_role",
  ]) {
    if (conn.prepare("SELECT 1 FROM schema_versions WHERE name=?").get(name))
      continue;
    conn.exec("BEGIN IMMEDIATE");
    try {
      if (
        !conn.prepare("SELECT 1 FROM schema_versions WHERE name=?").get(name)
      ) {
        conn.exec(
          readFileSync(
            new URL("../drizzle/" + name + ".sql", import.meta.url),
            "utf8",
          ),
        );
        conn.prepare("INSERT INTO schema_versions VALUES(?)").run(name);
      }
      conn.exec("COMMIT");
    } catch (e) {
      conn.exec("ROLLBACK");
      throw e;
    }
  }
  const DB = {
    prepare(sql) {
      const q = conn.prepare(sql);
      return {
        bind(...args) {
          return {
            first: () => q.get(...args) ?? null,
            all: () => ({ results: q.all(...args) }),
            run: () => ({ meta: q.run(...args) }),
          };
        },
      };
    },
  };
  const files = join(root, "inputs");
  mkdirSync(files, { recursive: true });
  const file = (key) => {
    if (!/^input-[a-f0-9-]{36}$/.test(key)) throw Error("invalid key");
    return join(files, key);
  };
  const BUCKET = {
    put: (key, data) => writeFileSync(file(key), data),
    get: (key) =>
      existsSync(file(key)) ? { body: readFileSync(file(key)) } : null,
    delete: (key) => unlinkSync(file(key)),
  };
  return { DB, BUCKET, close: () => conn.close() };
}
