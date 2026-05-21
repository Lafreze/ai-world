import { query } from "../db/index.js";
import { decide } from "./decision.js";
import { applyAction, logEvent } from "./actions.js";

let tickCount = 0;
let running = false;
let timer = null;
let dbDown = false;

const SCHEDULER_MS = parseInt(process.env.SCHEDULER_MS || "250", 10);

export function startSimulation(fastify) {
  if (running) return;
  running = true;

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
          console.warn(
            `[tick] db unreachable (${err.code}); will keep retrying quietly`,
          );
        }
      } else {
        console.error("[tick] error:", err);
      }
    } finally {
      if (running) {
        const delay = dbDown ? 4000 : SCHEDULER_MS;
        timer = setTimeout(step, delay);
      }
    }
  }

  timer = setTimeout(step, SCHEDULER_MS);
  console.log(`[sim] started (scheduler=${SCHEDULER_MS}ms)`);
}

export function stopSimulation() {
  running = false;
  if (timer) clearTimeout(timer);
}

async function tickWorld(world, fastify) {
  // Pull only agents whose next_tick_at is due. Lock them by bumping next_tick_at
  // up-front to a future placeholder so the same agent isn't re-picked while
  // its decision is being computed.
  const due = await query(
    `SELECT * FROM agents
     WHERE world_id=$1 AND next_tick_at <= NOW()
     ORDER BY next_tick_at ASC
     LIMIT 8`,
    [world.id],
  );
  if (due.rows.length === 0) return;

  // Snapshot the full agent + cell state once for perception.
  const allAgents = await query(
    `SELECT id, name, x, z, facing, attributes FROM agents WHERE world_id=$1`,
    [world.id],
  );
  const cellsRes = await query(
    `SELECT x, z, terrain, kind, floors FROM cells WHERE world_id=$1`,
    [world.id],
  );
  const cellMap = new Map();
  for (const c of cellsRes.rows) cellMap.set(`${c.x},${c.z}`, c);

  // Pull the last 30 seconds of speech in this world so agents can actually
  // respond to what was just said instead of greeting in a vacuum.
  const saysRes = await query(
    `SELECT e.agent_id, a.name AS speaker, a.x AS sx, a.z AS sz,
            e.payload, e.created_at
       FROM agent_events e
       JOIN agents a ON a.id = e.agent_id
      WHERE e.world_id = $1 AND e.event_type = 'say'
        AND e.created_at > NOW() - interval '30 seconds'
      ORDER BY e.created_at DESC
      LIMIT 30`,
    [world.id],
  );

  const occupied = new Set();
  for (const a of allAgents.rows) occupied.add(`${a.x},${a.z}`);

  const ctx = {
    worldId: world.id,
    tick: tickCount,
    cellMap,
    agents: allAgents.rows,
    recentSays: saysRes.rows,
    gridSize: world.grid_size,
    occupied,
    broadcast: fastify.broadcast,
  };

  for (const agent of due.rows) {
    try {
      const action = await decide(agent, ctx);
      await applyAction(agent, action, ctx);
      if (action.thought) {
        await logEvent(agent.id, world.id, tickCount, "think", {
          thought: action.thought,
        });
      }
    } catch (err) {
      console.warn(`[tick] agent ${agent.id} failed:`, err.message);
    } finally {
      // Schedule the agent's next decision based on its own interval (with a tiny jitter).
      const interval = Math.max(200, agent.tick_interval_ms || 1500);
      const jitter = Math.floor(Math.random() * 200);
      await query(
        `UPDATE agents SET next_tick_at = NOW() + ($1::int || ' milliseconds')::interval
         WHERE id=$2`,
        [interval + jitter, agent.id],
      );
    }
  }
}
