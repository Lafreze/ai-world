import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { pool } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../db/migrations");

export async function runMigrations({ closePool = false } = {}) {
  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const sql = await fs.readFile(path.join(migrationsDir, f), "utf8");
    console.log(`[migrate] applying ${f}`);
    await pool.query(sql);
  }

  const adminUser = process.env.ADMIN_USERNAME || "admin";
  const adminPass = process.env.ADMIN_PASSWORD || "admin123";
  const hash = await bcrypt.hash(adminPass, 10);
  await pool.query(
    `INSERT INTO users (username, password_hash, role)
     VALUES ($1, $2, 'admin')
     ON CONFLICT (username) DO UPDATE SET role = 'admin'`,
    [adminUser, hash],
  );
  console.log(`[migrate] admin user '${adminUser}' ready`);

  const w = await pool.query(`SELECT id FROM worlds ORDER BY id ASC LIMIT 1`);
  if (w.rows.length === 0) {
    const owner = await pool.query(`SELECT id FROM users WHERE username=$1`, [
      adminUser,
    ]);
    const ownerId = owner.rows[0]?.id ?? null;
    const ins = await pool.query(
      `INSERT INTO worlds (name, grid_size, owner_id) VALUES ('Default World', 16, $1) RETURNING id`,
      [ownerId],
    );
    console.log(`[migrate] created default world id=${ins.rows[0].id}`);
  }

  if (closePool) await pool.end();
  console.log("[migrate] done");
}

// Retry wrapper for boot-time migration: DB may not be ready immediately.
export async function runMigrationsWithRetry(
  maxAttempts = 12,
  baseDelayMs = 2000,
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await runMigrations({ closePool: false });
      return true;
    } catch (err) {
      const wait = Math.min(15000, baseDelayMs * attempt);
      console.warn(
        `[migrate] attempt ${attempt}/${maxAttempts} failed (${err.code || err.message}); retrying in ${wait}ms`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  console.error("[migrate] giving up after retries");
  return false;
}

// Allow running as a CLI: `node server/db/migrate.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations({ closePool: true }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
