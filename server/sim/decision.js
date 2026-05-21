import OpenAI from "openai";
import { dirVec, isPassable } from "./actions.js";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";

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

// Greeting variety for rule-based fallback so dialogue isn't only "Hi <name>"
const GREETINGS = [
  (n) => `Hi ${n}!`,
  (n) => `Hey ${n}, how are you?`,
  (n) => `Morning ${n}.`,
  (n) => `Oh, it's you, ${n}.`,
  (n) => `Nice to see you, ${n}.`,
  (n) => `${n}! What are you up to?`,
];
const MUSINGS = [
  "Wonder what's over there...",
  "The wind feels nice today.",
  "I should find something to eat.",
  "Did I hear something?",
  "What a quiet afternoon.",
  "Where to next?",
];
const SOLO_LINES = [
  "Hmm.",
  "La la la~",
  "(humming softly)",
  "Beautiful day.",
  "Time to wander.",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Rule-based fallback decision (now with more variety)
export function ruleDecide(agent, perception) {
  const p = agent.personality || {};
  const a = agent.attributes || {};
  const lazy = (p.laziness ?? 50) / 100;
  const social = (p.sociability ?? 50) / 100;
  const curious = (p.curiosity ?? 50) / 100;
  const kindness = (p.kindness ?? 50) / 100;

  if ((a.energy ?? 100) < 20) {
    return { type: "rest", thought: "I'm exhausted." };
  }

  // Adjacent neighbor + sociable? Greet with a varied line.
  const near = perception.neighbors.find((n) => n.dist <= 1);
  if (near && Math.random() < 0.35 + social * 0.5) {
    const line = pick(GREETINGS)(near.name);
    return { type: "say", text: line, thought: `Greeting ${near.name}` };
  }

  // Kind agent occasionally muses out loud to no one in particular.
  if (Math.random() < kindness * 0.08) {
    return { type: "say", text: pick(SOLO_LINES), thought: pick(MUSINGS) };
  }

  if (Math.random() < lazy * 0.5) {
    return { type: "idle", thought: pick(MUSINGS) };
  }

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

const DEFAULT_SYSTEM_PROMPT = `You are an autonomous tiny-world villager. Stay in character based on the personality numbers (0-100).
You receive a JSON state and must reply with ONE JSON action.
Allowed actions:
- {"type":"move","dir":0|1|2|3,"thought":"..."}  // 0=N 1=E 2=S 3=W
- {"type":"rest","thought":"..."}
- {"type":"say","text":"a short, in-character line","thought":"..."}
- {"type":"idle","thought":"..."}
The "say" text should be varied, short (under 50 chars), reflect mood/personality, and reference what's around when natural. Avoid repeating the same line. Respond ONLY with JSON.`;

export async function llmDecide(agent, perception) {
  if (!client) return null;
  try {
    const sys = agent.system_prompt || DEFAULT_SYSTEM_PROMPT;
    const model = agent.ai_model || DEFAULT_MODEL;
    const user = JSON.stringify({
      me: {
        name: agent.name,
        personality: agent.personality,
        attributes: agent.attributes,
        goals: agent.goals,
        position: { x: agent.x, z: agent.z },
        facing: agent.facing,
        last_thought: agent.last_thought,
      },
      perception,
    });
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.9,
      response_format: { type: "json_object" },
      max_tokens: 200,
    });
    const text = resp.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed.type !== "string") return null;
    return parsed;
  } catch (err) {
    console.warn(`[llm] decision failed (${agent.name}):`, err.message);
    return null;
  }
}

export async function decide(agent, ctx) {
  const perception = perceive(agent, ctx);
  perception.cellMapLookup = (x, z) => ctx.cellMap.get(`${x},${z}`);

  // Per-agent llm_probability (0..1). If neighbors are right next door, boost it.
  const baseProb =
    typeof agent.llm_probability === "number" ? agent.llm_probability : 0.4;
  const neighborBoost = perception.neighbors.length > 0 ? 0.3 : 0;
  const useLLM =
    client && Math.random() < Math.min(1, baseProb + neighborBoost);

  if (useLLM) {
    const llm = await llmDecide(agent, perception);
    if (llm) return llm;
  }
  return ruleDecide(agent, perception);
}
