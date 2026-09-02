import "dotenv/config";
import fs from "fs";
import path from "path";
import { createClient } from "@libsql/client";

/**
 * Prisma's own CLI (`migrate deploy`) cannot connect to a `libsql://` URL —
 * it only understands the drivers it ships with, and the libsql adapter is
 * an application-level thing, not something the CLI knows about. So this
 * script does what `migrate deploy` does, by hand: apply each migration's
 * SQL directly through the libsql client, and record it in Prisma's own
 * `_prisma_migrations` table so `prisma migrate status` still reports
 * correctly and nothing about the schema/migration workflow forks in two
 * directions between local (SQLite file) and production (Turso).
 */
async function main() {
  const url = process.env.DATABASE_URL;
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  if (!url || !url.startsWith("libsql://")) {
    throw new Error("DATABASE_URL must be a libsql:// URL — this script is for Turso, not local SQLite.");
  }

  const client = createClient({ url, authToken });

  await client.execute(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
    )
  `);

  const migrationsDir = path.join(__dirname, "migrations");
  const names = fs
    .readdirSync(migrationsDir)
    .filter((n) => fs.statSync(path.join(migrationsDir, n)).isDirectory())
    .sort();

  const applied = await client.execute(`SELECT migration_name FROM "_prisma_migrations"`);
  const appliedNames = new Set(applied.rows.map((r) => r.migration_name as string));

  for (const name of names) {
    if (appliedNames.has(name)) {
      console.log(`skip  ${name} (already applied)`);
      continue;
    }

    const sqlPath = path.join(migrationsDir, name, "migration.sql");
    const sql = fs.readFileSync(sqlPath, "utf8");
    // Migration files are batches of statements separated by blank lines
    // after each `-- Comment` header; splitting on `;` is enough here since
    // none of these migrations use `;` inside string literals or triggers.
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    console.log(`apply ${name} (${statements.length} statement(s))`);
    for (const statement of statements) {
      try {
        await client.execute(statement);
      } catch (e) {
        // Some of this table's objects were evidently created outside this
        // tracking table already — e.g. one of the platform-admin
        // /api/internal/migrate-* routes, run ahead of this script actually
        // succeeding for that migration. Tolerated the same way those
        // routes already tolerate it themselves (see migrate-api-keys/
        // route.ts's own catch blocks): the end state this statement wants
        // already exists, so there's nothing left for it to do. Anything
        // else still fails loudly — this only recognizes the specific
        // "the thing I'm creating is already there" shape of error.
        const msg = e instanceof Error ? e.message : String(e);
        if (/already exists|duplicate column/i.test(msg)) {
          console.log(`  (already present, skipped) ${statement.slice(0, 70).replace(/\s+/g, " ")}...`);
        } else {
          throw e;
        }
      }
    }

    const id = crypto.randomUUID();
    await client.execute({
      sql: `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (?, ?, datetime('now'), ?, ?)`,
      args: [id, "manual-deploy", name, statements.length],
    });
  }

  console.log("Done — Turso database is up to date.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
