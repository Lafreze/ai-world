import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { pool } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../db/migrations");

async function run() {
  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const sql = await fs.readFile(path.join(migrationsDir, f), "utf8");
    console.log(`[migrate] applying ${f}`);
    await pool.query(sql);
  }

  // Ensure default admin user exists
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

  // Ensure a default world exists
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

  await pool.end();
  console.log("[migrate] done");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
