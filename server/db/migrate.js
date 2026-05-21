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
      `INSERT INTO worlds (name, grid_size, owner_id) VALUES ('Default World', 32, $1) RETURNING id`,
      [ownerId],
    );
    worldId = ins.rows[0].id;
    console.log(`[migrate] created default world id=${worldId}`);
  } else {
    worldId = w.rows[0].id;
  }

  // Read the world's grid_size so the seeder can adapt.
  const gs = await pool.query(`SELECT grid_size FROM worlds WHERE id=$1`, [
    worldId,
  ]);
  const gridSize = gs.rows[0]?.grid_size ?? 32;

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
    await seedWorld(worldId, gridSize);
    console.log(
      `[migrate] seeded world id=${worldId} (${gridSize}x${gridSize})`,
    );
  }

  if (closePool) await pool.end();
  console.log("[migrate] done");
}

async function seedWorld(worldId, gridSize = 32) {
  // Procedural generation for a gridSize x gridSize world.
  // World coords range from -half .. half-1 in both axes.
  const half = Math.floor(gridSize / 2);
  const cells = new Map(); // "x,z" -> { terrain, kind }
  const set = (x, z, terrain, kind = null) => {
    if (x < -half || x >= half || z < -half || z >= half) return;
    cells.set(`${x},${z}`, { x, z, terrain, kind });
  };
  const get = (x, z) => cells.get(`${x},${z}`);
  const isFree = (x, z) => {
    const c = get(x, z);
    return !c || (c.terrain === "grass" && !c.kind);
  };

  // ----- Paths: two main roads crossing through origin, plus offshoots -----
  for (let x = -half; x < half; x++) set(x, 0, "path");
  for (let z = -half; z < half; z++) set(0, z, "path");
  // Side path west
  for (let z = -half + 2; z <= 0; z++) set(-Math.floor(half / 2), z, "path");
  // Side path east
  for (let z = 0; z < half - 2; z++) set(Math.floor(half / 2), z, "path");

  // ----- Two ponds with sand rims -----
  const ponds = [
    { cx: -Math.floor(half * 0.55), cz: -Math.floor(half * 0.55), r: 3 },
    { cx: Math.floor(half * 0.5), cz: Math.floor(half * 0.55), r: 2 },
  ];
  for (const p of ponds) {
    for (let dz = -p.r - 1; dz <= p.r + 1; dz++) {
      for (let dx = -p.r - 1; dx <= p.r + 1; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        const x = p.cx + dx;
        const z = p.cz + dz;
        if (get(x, z)?.terrain === "path") continue;
        if (d <= p.r) set(x, z, "water");
        else if (d === p.r + 1) set(x, z, "sand");
      }
    }
  }

  // ----- Forest patches (clusters of trees) -----
  const forests = [
    {
      cx: -Math.floor(half * 0.7),
      cz: Math.floor(half * 0.6),
      n: 14,
      spread: 4,
    },
    {
      cx: Math.floor(half * 0.7),
      cz: -Math.floor(half * 0.7),
      n: 12,
      spread: 4,
    },
    {
      cx: -Math.floor(half * 0.2),
      cz: Math.floor(half * 0.85),
      n: 8,
      spread: 3,
    },
  ];
  for (const f of forests) {
    for (let i = 0; i < f.n; i++) {
      const x = f.cx + Math.floor((Math.random() * 2 - 1) * f.spread);
      const z = f.cz + Math.floor((Math.random() * 2 - 1) * f.spread);
      if (isFree(x, z)) set(x, z, "grass", "tree");
    }
  }

  // ----- Villages (clusters of houses) -----
  const villages = [
    {
      cx: Math.floor(half * 0.4),
      cz: Math.floor(half * 0.3),
      houses: [
        [0, 0],
        [2, 0],
        [0, 2],
        [2, 2],
        [-1, 1],
      ],
    },
    {
      cx: -Math.floor(half * 0.35),
      cz: -Math.floor(half * 0.15),
      houses: [
        [0, 0],
        [2, 0],
        [1, -2],
      ],
    },
  ];
  for (const v of villages) {
    for (const [dx, dz] of v.houses) {
      const x = v.cx + dx;
      const z = v.cz + dz;
      if (isFree(x, z)) set(x, z, "grass", "house");
    }
  }

  // ----- Stone patch + scattered rocks -----
  const stoneCx = Math.floor(half * 0.85);
  const stoneCz = -Math.floor(half * 0.4);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = stoneCx + dx;
      const z = stoneCz + dz;
      if (isFree(x, z)) set(x, z, "stone");
    }
  }
  for (let i = 0; i < 8; i++) {
    const x = Math.floor((Math.random() * 2 - 1) * (half - 1));
    const z = Math.floor((Math.random() * 2 - 1) * (half - 1));
    if (isFree(x, z)) set(x, z, "grass", "rock");
  }

  // ----- Snow patch in one corner -----
  for (let dz = 0; dz < 4; dz++) {
    for (let dx = 0; dx < 4; dx++) {
      const x = -half + dx;
      const z = -half + dz;
      if (isFree(x, z)) set(x, z, "snow");
    }
  }

  // ----- Flowers & bushes scattered on grass -----
  for (let i = 0; i < 30; i++) {
    const x = Math.floor((Math.random() * 2 - 1) * (half - 1));
    const z = Math.floor((Math.random() * 2 - 1) * (half - 1));
    if (isFree(x, z)) set(x, z, "grass", "flower");
  }
  for (let i = 0; i < 18; i++) {
    const x = Math.floor((Math.random() * 2 - 1) * (half - 1));
    const z = Math.floor((Math.random() * 2 - 1) * (half - 1));
    if (isFree(x, z)) set(x, z, "grass", "bush");
  }

  // Persist all generated non-default cells.
  for (const c of cells.values()) {
    await pool.query(
      `INSERT INTO cells (world_id, x, z, terrain, kind, floors, terrain_floors)
       VALUES ($1, $2, $3, $4, $5, 1, 1)
       ON CONFLICT (world_id, x, z) DO NOTHING`,
      [worldId, c.x, c.z, c.terrain, c.kind ?? null],
    );
  }

  // ----- Villagers with distinct professions, goals, and personas -----
  const villagers = [
    {
      name: "Mira",
      x: 1,
      z: 1,
      profession: "explorer",
      goals: ["Map every corner of the woods", "Find the hidden pond"],
      appearance: {
        skinColor: "#f1c27d",
        hairColor: "#5a3a1b",
        shirtColor: "#e07a5f",
        pantsColor: "#3d405b",
      },
      personality: {
        curiosity: 90,
        bravery: 70,
        sociability: 65,
        laziness: 15,
        kindness: 70,
      },
      tick_interval_ms: 1200,
      llm_probability: 0.7,
      system_prompt:
        "You are Mira, an explorer obsessed with discovering new places. Speak with energy and wonder. Reply in JSON as instructed.",
    },
    {
      name: "Otto",
      x: -2,
      z: -1,
      profession: "elder",
      goals: ["Rest by the pond", "Avoid the children"],
      appearance: {
        skinColor: "#e0ac69",
        hairColor: "#222222",
        shirtColor: "#81b29a",
        pantsColor: "#3d405b",
      },
      personality: {
        curiosity: 25,
        bravery: 80,
        sociability: 25,
        laziness: 70,
        kindness: 40,
      },
      tick_interval_ms: 2400,
      llm_probability: 0.3,
      system_prompt:
        "You are Otto, the village elder — gruff, lazy, opinionated. Speak tersely, occasionally grumble. Reply in JSON as instructed.",
    },
    {
      name: "Wren",
      x: 2,
      z: -2,
      profession: "trader",
      goals: ["Greet every villager today", "Hear the latest gossip"],
      appearance: {
        skinColor: "#c68642",
        hairColor: "#c79b5b",
        shirtColor: "#f2cc8f",
        pantsColor: "#5a3a1b",
      },
      personality: {
        curiosity: 65,
        bravery: 35,
        sociability: 95,
        laziness: 35,
        kindness: 85,
      },
      tick_interval_ms: 1500,
      llm_probability: 0.8,
      system_prompt:
        "You are Wren, a warm trader who loves chatting and remembers everyone. Ask questions, share small observations. Reply in JSON as instructed.",
    },
    {
      name: "Felix",
      x: Math.floor(half * 0.4),
      z: Math.floor(half * 0.3) - 1,
      profession: "farmer",
      goals: ["Tend the flower fields", "Keep the path swept"],
      appearance: {
        skinColor: "#d2a06a",
        hairColor: "#3a2510",
        shirtColor: "#6b9a4a",
        pantsColor: "#4a3318",
      },
      personality: {
        curiosity: 40,
        bravery: 50,
        sociability: 55,
        laziness: 30,
        kindness: 80,
      },
      tick_interval_ms: 1800,
      llm_probability: 0.5,
      system_prompt:
        "You are Felix, a patient flower farmer who notices small things in nature. Speak gently. Reply in JSON as instructed.",
    },
    {
      name: "Luna",
      x: -Math.floor(half * 0.35),
      z: -Math.floor(half * 0.15) + 1,
      profession: "scholar",
      goals: ["Observe villagers and record habits", "Identify each plant"],
      appearance: {
        skinColor: "#f4d3a3",
        hairColor: "#1f1f1f",
        shirtColor: "#5a6abf",
        pantsColor: "#2a2f44",
      },
      personality: {
        curiosity: 95,
        bravery: 40,
        sociability: 50,
        laziness: 25,
        kindness: 60,
      },
      tick_interval_ms: 1700,
      llm_probability: 0.7,
      system_prompt:
        "You are Luna, a quiet scholar cataloguing the world. Speak precisely, ask probing questions. Reply in JSON as instructed.",
    },
    {
      name: "Pip",
      x: Math.floor(half * 0.4) + 1,
      z: Math.floor(half * 0.3) + 2,
      profession: "child",
      goals: ["Find someone to play with", "Pick flowers"],
      appearance: {
        skinColor: "#f7d8a5",
        hairColor: "#d4a35a",
        shirtColor: "#f08bb4",
        pantsColor: "#6b3fa0",
      },
      personality: {
        curiosity: 80,
        bravery: 50,
        sociability: 85,
        laziness: 20,
        kindness: 75,
      },
      tick_interval_ms: 1000,
      llm_probability: 0.6,
      system_prompt:
        "You are Pip, an excitable child. Speak in short bursts, exclaim often, get distracted easily. Reply in JSON as instructed.",
    },
  ];

  for (const v of villagers) {
    await pool.query(
      `INSERT INTO agents (
         world_id, name, x, z, appearance, personality, attributes,
         tick_interval_ms, llm_probability, system_prompt,
         profession, goals
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12::jsonb)`,
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
        v.profession,
        JSON.stringify(v.goals),
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
