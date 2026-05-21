import OpenAI from "openai";
import { dirVec, isPassable } from "./actions.js";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";

// Build a compact perception summary for an agent.
export function perceive(agent, ctx) {
  const { cellMap, agents, gridSize } = ctx;
  const half = Math.floor(gridSize / 2);
  const around = [];
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dz === 0) continue;
      const x = agent.x + dx;
      const z = agent.z + dz;
      if (x < -half || x > half - 1 || z < -half || z > half - 1) continue;
      const cell = cellMap.get(`${x},${z}`);
      if (cell && (cell.terrain !== "grass" || cell.kind)) {
        around.push({ dx, dz, terrain: cell.terrain, kind: cell.kind });
      }
    }
  }
  const neighbors = agents
    .filter((a) => a.id !== agent.id)
    .map((a) => ({
      id: a.id,
      name: a.name,
      dx: a.x - agent.x,
      dz: a.z - agent.z,
      dist: Math.abs(a.x - agent.x) + Math.abs(a.z - agent.z),
    }))
    .filter((n) => n.dist <= 4)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 4);
  return { around, neighbors };
}

// Rule-based fallback decision
export function ruleDecide(agent, perception) {
  const p = agent.personality || {};
  const a = agent.attributes || {};
  const lazy = (p.laziness ?? 50) / 100;
  const social = (p.sociability ?? 50) / 100;
  const curious = (p.curiosity ?? 50) / 100;

  // Tired? Rest.
  if ((a.energy ?? 100) < 20)
    return { type: "rest", thought: "I'm exhausted." };

  // Adjacent neighbor + sociable? Greet.
  const near = perception.neighbors.find((n) => n.dist <= 1);
  if (near && Math.random() < 0.4 + social * 0.4) {
    return {
      type: "say",
      text: `Hi ${near.name}!`,
      thought: `Greeting ${near.name}`,
    };
  }

  // Lazy roll → idle
  if (Math.random() < lazy * 0.5)
    return { type: "idle", thought: "Just standing here." };

  // Curious → move toward unexplored area or random
  // Try a random direction up to 4 attempts
  for (let i = 0; i < 4; i++) {
    const dir = Math.floor(Math.random() * 4);
    const [dx, dz] = dirVec(dir);
    const nx = agent.x + dx;
    const nz = agent.z + dz;
    const cell = perception.cellMapLookup
      ? perception.cellMapLookup(nx, nz)
      : null;
    if (isPassable(cell)) {
      return {
        type: "move",
        dir,
        thought: curious > 0.6 ? "Let's explore!" : "Wandering.",
      };
    }
  }
  return { type: "idle", thought: "Nowhere to go." };
}

// LLM decision (optional). Returns null on failure → caller falls back to rules.
export async function llmDecide(agent, perception) {
  if (!client) return null;
  try {
    const sys = `You are an autonomous tiny-world villager. You receive a JSON state and must reply with ONE JSON action.
Allowed actions:
- {"type":"move","dir":0|1|2|3,"thought":"..."}  // 0=N 1=E 2=S 3=W
- {"type":"rest","thought":"..."}
- {"type":"say","text":"short line","thought":"..."}
- {"type":"idle","thought":"..."}
Pick an action that fits the character's personality and current state. Keep "text" under 60 chars. Respond ONLY with JSON.`;
    const user = JSON.stringify({
      me: {
        name: agent.name,
        personality: agent.personality,
        attributes: agent.attributes,
        goals: agent.goals,
        position: { x: agent.x, z: agent.z },
        facing: agent.facing,
      },
      perception,
    });
    const resp = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.8,
      response_format: { type: "json_object" },
      max_tokens: 200,
    });
    const text = resp.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed.type !== "string") return null;
    return parsed;
  } catch (err) {
    console.warn("[llm] decision failed:", err.message);
    return null;
  }
}

export async function decide(agent, ctx) {
  const perception = perceive(agent, ctx);
  perception.cellMapLookup = (x, z) => ctx.cellMap.get(`${x},${z}`);
  // Probability of consulting LLM — higher when neighbors nearby or when curious
  const useLLM =
    client &&
    (perception.neighbors.length > 0 ||
      Math.random() < ((agent.personality?.curiosity ?? 50) / 100) * 0.3);
  if (useLLM) {
    const llm = await llmDecide(agent, perception);
    if (llm) return llm;
  }
  return ruleDecide(agent, perception);
}
