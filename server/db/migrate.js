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
  let worldId;
  if (w.rows.length === 0) {
    const owner = await pool.query(`SELECT id FROM users WHERE username=$1`, [
      adminUser,
    ]);
    const ownerId = owner.rows[0]?.id ?? null;
    const ins = await pool.query(
      `INSERT INTO worlds (name, grid_size, owner_id) VALUES ('Default World', 16, $1) RETURNING id`,
      [ownerId],
    );
    worldId = ins.rows[0].id;
    console.log(`[migrate] created default world id=${worldId}`);
  } else {
    worldId = w.rows[0].id;
  }

  // Seed sample cells + agents if the world is empty.
  const cellCount = await pool.query(
    `SELECT COUNT(*)::int AS n FROM cells WHERE world_id=$1`,
    [worldId],
  );
  const agentCount = await pool.query(
    `SELECT COUNT(*)::int AS n FROM agents WHERE world_id=$1`,
    [worldId],
  );
  if (cellCount.rows[0].n === 0 && agentCount.rows[0].n === 0) {
    await seedWorld(worldId);
    console.log(`[migrate] seeded world id=${worldId}`);
  }

  if (closePool) await pool.end();
  console.log("[migrate] done");
}

async function seedWorld(worldId) {
  // A small village: dirt path crossing, a pond, a few trees, houses, flowers.
  const cells = [];

  // Horizontal path
  for (let x = -7; x <= 6; x++) cells.push({ x, z: 0, terrain: "path" });
  // Vertical path
  for (let z = -7; z <= 6; z++) cells.push({ x: 0, z, terrain: "path" });

  // Pond (water + sand rim)
  for (let x = -6; x <= -4; x++) {
    for (let z = -6; z <= -4; z++) {
      cells.push({ x, z, terrain: "water" });
    }
  }
  for (const [x, z] of [
    [-7, -6],
    [-7, -5],
    [-7, -4],
    [-3, -6],
    [-3, -5],
    [-3, -4],
    [-6, -7],
    [-5, -7],
    [-4, -7],
    [-6, -3],
    [-5, -3],
    [-4, -3],
  ]) {
    cells.push({ x, z, terrain: "sand" });
  }

  // Trees
  for (const [x, z] of [
    [-2, 3],
    [3, 4],
    [5, -2],
    [-5, 5],
    [4, -5],
  ]) {
    cells.push({ x, z, terrain: "grass", kind: "tree" });
  }

  // Houses
  for (const [x, z] of [
    [3, 2],
    [-3, -2],
    [5, 5],
  ]) {
    cells.push({ x, z, terrain: "grass", kind: "house" });
  }

  // Flowers and bushes
  for (const [x, z] of [
    [2, 3],
    [-2, 4],
    [4, 3],
    [-4, 2],
  ]) {
    cells.push({ x, z, terrain: "grass", kind: "flower" });
  }
  for (const [x, z] of [
    [-3, 3],
    [3, -3],
  ]) {
    cells.push({ x, z, terrain: "grass", kind: "bush" });
  }

  // Stone/rocks
  for (const [x, z] of [
    [6, 6],
    [-6, 6],
    [6, -7],
  ]) {
    cells.push({ x, z, terrain: "grass", kind: "rock" });
  }

  for (const c of cells) {
    await pool.query(
      `INSERT INTO cells (world_id, x, z, terrain, kind, floors, terrain_floors)
       VALUES ($1, $2, $3, $4, $5, 1, 1)
       ON CONFLICT (world_id, x, z) DO NOTHING`,
      [worldId, c.x, c.z, c.terrain, c.kind ?? null],
    );
  }

  // Three sample villagers with distinct personalities.
  const villagers = [
    {
      name: "Mira",
      x: 1,
      z: 1,
      appearance: {
        skinColor: "#f1c27d",
        hairColor: "#5a3a1b",
        shirtColor: "#e07a5f",
        pantsColor: "#3d405b",
      },
      personality: {
        curiosity: 85,
        bravery: 60,
        sociability: 70,
        laziness: 20,
        kindness: 75,
      },
    },
    {
      name: "Otto",
      x: -2,
      z: -1,
      appearance: {
        skinColor: "#e0ac69",
        hairColor: "#222222",
        shirtColor: "#81b29a",
        pantsColor: "#3d405b",
      },
      personality: {
        curiosity: 30,
        bravery: 80,
        sociability: 25,
        laziness: 60,
        kindness: 40,
      },
    },
    {
      name: "Wren",
      x: 2,
      z: -2,
      appearance: {
        skinColor: "#c68642",
        hairColor: "#c79b5b",
        shirtColor: "#f2cc8f",
        pantsColor: "#5a3a1b",
      },
      personality: {
        curiosity: 65,
        bravery: 35,
        sociability: 90,
        laziness: 45,
        kindness: 85,
      },
    },
  ];
  // Per-villager AI flavor: tick interval (how often they act) + LLM use probability + persona prompt
  villagers[0].tick_interval_ms = 1200;
  villagers[0].llm_probability = 0.7;
  villagers[0].system_prompt =
    "You are Mira, a curious, brave explorer who loves discovering new places. " +
    "Speak with energy and wonder. Reply in JSON as instructed.";

  villagers[1].tick_interval_ms = 2200;
  villagers[1].llm_probability = 0.3;
  villagers[1].system_prompt =
    "You are Otto, a gruff and lazy old man who prefers naps to adventure. " +
    "Speak tersely, occasionally grumble. Reply in JSON as instructed.";

  villagers[2].tick_interval_ms = 1500;
  villagers[2].llm_probability = 0.8;
  villagers[2].system_prompt =
    "You are Wren, a warm and sociable villager who likes chatting with everyone. " +
    "Speak kindly, ask questions, mention what you see. Reply in JSON as instructed.";

  for (const v of villagers) {
    await pool.query(
      `INSERT INTO agents (
         world_id, name, x, z, appearance, personality, attributes,
         tick_interval_ms, llm_probability, system_prompt
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10)`,
      [
        worldId,
        v.name,
        v.x,
        v.z,
        JSON.stringify(v.appearance),
        JSON.stringify(v.personality),
        JSON.stringify({
          hp: 100,
          energy: 85,
          hunger: 15,
          social: 50,
          mood: 70,
        }),
        v.tick_interval_ms,
        v.llm_probability,
        v.system_prompt,
      ],
    );
  }
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
