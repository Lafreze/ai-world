import { query } from "../db/index.js";
import { decide } from "./decision.js";
import { applyAction, logEvent } from "./actions.js";

let tickCount = 0;
let running = false;
let timer = null;
let dbDown = false;
let dbDownSince = 0;

export function startSimulation(fastify) {
  if (running) return;
  running = true;
  const interval = parseInt(process.env.TICK_INTERVAL_MS || "1500", 10);

  async function step() {
    try {
      tickCount++;
      const worlds = await query(`SELECT id, grid_size FROM worlds`);
      if (dbDown) {
        console.log("[tick] db recovered");
        dbDown = false;
      }
      for (const w of worlds.rows) {
        await tickWorld(w, fastify);
      }
    } catch (err) {
      if (
        err.code === "ECONNREFUSED" ||
        err.code === "57P03" ||
        err.code === "ENOTFOUND"
      ) {
        if (!dbDown) {
          dbDown = true;
          dbDownSince = Date.now();
          console.warn(
            `[tick] db unreachable (${err.code}); will keep retrying quietly`,
          );
        }
      } else {
        console.error("[tick] error:", err);
      }
    } finally {
      if (running) {
        const delay = dbDown ? Math.min(10000, interval * 4) : interval;
        timer = setTimeout(step, delay);
      }
    }
  }

  timer = setTimeout(step, interval);
  console.log(`[sim] started (interval=${interval}ms)`);
}

export function stopSimulation() {
  running = false;
  if (timer) clearTimeout(timer);
}

async function tickWorld(world, fastify) {
  const agentsRes = await query(
    `SELECT * FROM agents WHERE world_id=$1 ORDER BY id ASC`,
    [world.id],
  );
  const cellsRes = await query(
    `SELECT x, z, terrain, kind, floors FROM cells WHERE world_id=$1`,
    [world.id],
  );
  const cellMap = new Map();
  for (const c of cellsRes.rows) cellMap.set(`${c.x},${c.z}`, c);

  const occupied = new Set();
  for (const a of agentsRes.rows) occupied.add(`${a.x},${a.z}`);

  const ctx = {
    worldId: world.id,
    tick: tickCount,
    cellMap,
    agents: agentsRes.rows,
    gridSize: world.grid_size,
    occupied,
    broadcast: fastify.broadcast,
  };

  // Decisions are async (LLM); run sequentially to keep budget predictable.
  for (const agent of agentsRes.rows) {
    const action = await decide(agent, ctx);
    await applyAction(agent, action, ctx);
    if (action.thought) {
      await logEvent(agent.id, world.id, tickCount, "think", {
        thought: action.thought,
      });
    }
  }
}
