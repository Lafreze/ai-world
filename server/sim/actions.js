import { query } from "../db/index.js";

// Terrain passability
const BLOCKED_TERRAIN = new Set(["water", "lava"]);
const BLOCKED_KIND = new Set(["house", "rock", "tree"]);

export function isPassable(cell) {
  if (!cell) return true; // default grass
  if (BLOCKED_TERRAIN.has(cell.terrain) && cell.kind !== "bridge") return false;
  if (BLOCKED_KIND.has(cell.kind)) return false;
  return true;
}

const DIR_VECTORS = [
  [0, -1], // 0 = N
  [1, 0], // 1 = E
  [0, 1], // 2 = S
  [-1, 0], // 3 = W
];

export function dirVec(facing) {
  return DIR_VECTORS[((facing % 4) + 4) % 4];
}

export async function logEvent(agentId, worldId, tick, type, payload = {}) {
  await query(
    `INSERT INTO agent_events (agent_id, world_id, tick, event_type, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [agentId, worldId, tick, type, JSON.stringify(payload)],
  );
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Apply an action to an agent's row; returns updated agent
export async function applyAction(agent, action, ctx) {
  const { worldId, tick, cellMap, gridSize, broadcast } = ctx;
  const attrs = { ...agent.attributes };
  let x = agent.x;
  let z = agent.z;
  let facing = agent.facing;
  let lastAction = action.type;
  let lastThought = action.thought || agent.last_thought || "";

  switch (action.type) {
    case "move": {
      const dir = clamp(action.dir ?? facing, 0, 3);
      facing = dir;
      const [dx, dz] = dirVec(dir);
      const nx = x + dx;
      const nz = z + dz;
      const half = Math.floor(gridSize / 2);
      if (nx < -half || nx > half - 1 || nz < -half || nz > half - 1) {
        lastAction = "move-blocked-edge";
        break;
      }
      const target = cellMap.get(`${nx},${nz}`);
      if (!isPassable(target)) {
        lastAction = "move-blocked";
        break;
      }
      // No two agents on same cell
      if (ctx.occupied.has(`${nx},${nz}`)) {
        lastAction = "move-blocked-agent";
        break;
      }
      ctx.occupied.delete(`${x},${z}`);
      ctx.occupied.add(`${nx},${nz}`);
      x = nx;
      z = nz;
      attrs.energy = clamp((attrs.energy ?? 80) - 1, 0, 100);
      attrs.hunger = clamp((attrs.hunger ?? 0) + 1, 0, 100);
      break;
    }
    case "rest": {
      attrs.energy = clamp((attrs.energy ?? 50) + 8, 0, 100);
      attrs.mood = clamp((attrs.mood ?? 50) + 2, 0, 100);
      break;
    }
    case "say": {
      const text = String(action.text || "").slice(0, 200);
      attrs.social = clamp((attrs.social ?? 50) + 5, 0, 100);
      // Face an adjacent neighbor (if any) so the two characters look at each other.
      const others = (ctx.agents || []).filter((o) => o.id !== agent.id);
      const adj = others.find(
        (o) => Math.abs(o.x - x) + Math.abs(o.z - z) === 1,
      );
      if (adj) {
        const ddx = adj.x - x;
        const ddz = adj.z - z;
        if (ddz < 0) facing = 0;
        else if (ddx > 0) facing = 1;
        else if (ddz > 0) facing = 2;
        else if (ddx < 0) facing = 3;
      }
      await logEvent(agent.id, worldId, tick, "say", { text });
      broadcast(worldId, { type: "say", agentId: agent.id, text });
      lastThought = text;
      break;
    }
    case "wave":
    case "idle":
    default: {
      attrs.energy = clamp((attrs.energy ?? 50) + 1, 0, 100);
      break;
    }
  }

  await query(
    `UPDATE agents SET x=$1, z=$2, facing=$3, attributes=$4::jsonb,
                       last_action=$5, last_thought=$6
     WHERE id=$7`,
    [x, z, facing, JSON.stringify(attrs), lastAction, lastThought, agent.id],
  );

  broadcast(worldId, {
    type: "agent-tick",
    id: agent.id,
    x,
    z,
    facing,
    action: lastAction,
    thought: lastThought,
    attrs,
  });

  return {
    ...agent,
    x,
    z,
    facing,
    attributes: attrs,
    last_action: lastAction,
    last_thought: lastThought,
  };
}
