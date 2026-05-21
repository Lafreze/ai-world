import { query } from "../db/index.js";

function randomColor() {
  const h = Math.floor(Math.random() * 360);
  const s = 55 + Math.floor(Math.random() * 25);
  const l = 40 + Math.floor(Math.random() * 20);
  return `hsl(${h} ${s}% ${l}%)`;
}

function defaultAppearance() {
  return {
    skinColor: ["#f1c27d", "#e0ac69", "#c68642", "#8d5524"][
      Math.floor(Math.random() * 4)
    ],
    hairColor: ["#2b1d0e", "#5a3a1b", "#c79b5b", "#222"][
      Math.floor(Math.random() * 4)
    ],
    shirtColor: randomColor(),
    pantsColor: randomColor(),
  };
}

function defaultPersonality() {
  const rand = () => Math.floor(Math.random() * 100);
  return {
    curiosity: rand(),
    bravery: rand(),
    sociability: rand(),
    laziness: rand(),
    kindness: rand(),
  };
}

function defaultAttributes() {
  return { hp: 100, energy: 80, hunger: 20, social: 50, mood: 60 };
}

export default async function agentsRoutes(fastify) {
  // Public: list agents in a world
  fastify.get("/api/worlds/:id/agents", async (req) => {
    const id = parseInt(req.params.id, 10);
    const r = await query(
      `SELECT id, name, x, z, facing, appearance, personality, attributes,
              memory, goals, last_action, last_thought,
              tick_interval_ms, llm_probability, ai_model, system_prompt,
              profession, created_at
       FROM agents WHERE world_id=$1 ORDER BY id ASC`,
      [id],
    );
    return { agents: r.rows };
  });

  // Public: get single agent (with recent events)
  fastify.get("/api/agents/:id", async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const a = await query(`SELECT * FROM agents WHERE id=$1`, [id]);
    if (a.rows.length === 0)
      return reply.code(404).send({ error: "not found" });
    const ev = await query(
      `SELECT tick, event_type, payload, created_at FROM agent_events
       WHERE agent_id=$1 ORDER BY id DESC LIMIT 50`,
      [id],
    );
    return { agent: a.rows[0], events: ev.rows };
  });

  // Admin: create agent
  fastify.post(
    "/api/worlds/:id/agents",
    { preHandler: fastify.adminRequired },
    async (req, reply) => {
      const worldId = parseInt(req.params.id, 10);
      const {
        name,
        x = 0,
        z = 0,
        appearance,
        personality,
        attributes,
      } = req.body || {};
      if (!name) return reply.code(400).send({ error: "name required" });

      const r = await query(
        `INSERT INTO agents (world_id, name, x, z, appearance, personality, attributes)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
         RETURNING id, name, x, z, facing, appearance, personality, attributes`,
        [
          worldId,
          name,
          x,
          z,
          JSON.stringify(appearance || defaultAppearance()),
          JSON.stringify(personality || defaultPersonality()),
          JSON.stringify(attributes || defaultAttributes()),
        ],
      );
      fastify.broadcast(worldId, { type: "agent-created", agent: r.rows[0] });
      return r.rows[0];
    },
  );

  // Admin: delete agent
  fastify.delete(
    "/api/agents/:id",
    { preHandler: fastify.adminRequired },
    async (req) => {
      const id = parseInt(req.params.id, 10);
      const r = await query(
        `DELETE FROM agents WHERE id=$1 RETURNING world_id`,
        [id],
      );
      const worldId = r.rows[0]?.world_id;
      if (worldId) fastify.broadcast(worldId, { type: "agent-removed", id });
      return { ok: true };
    },
  );

  // Admin: update agent attributes / personality / position
  fastify.patch(
    "/api/agents/:id",
    { preHandler: fastify.adminRequired },
    async (req) => {
      const id = parseInt(req.params.id, 10);
      const scalarFields = [
        "name",
        "x",
        "z",
        "facing",
        "tick_interval_ms",
        "llm_probability",
        "ai_model",
        "system_prompt",
        "profession",
      ];
      const sets = [];
      const vals = [];
      let i = 1;
      for (const f of scalarFields) {
        if (req.body?.[f] !== undefined) {
          sets.push(`${f}=$${i++}`);
          vals.push(req.body[f]);
        }
      }
      for (const jf of ["appearance", "personality", "attributes", "goals"]) {
        if (req.body?.[jf] !== undefined) {
          sets.push(`${jf}=$${i++}::jsonb`);
          vals.push(JSON.stringify(req.body[jf]));
        }
      }
      if (sets.length === 0) return { ok: true };
      vals.push(id);
      const r = await query(
        `UPDATE agents SET ${sets.join(", ")} WHERE id=$${i} RETURNING world_id, id`,
        vals,
      );
      const wid = r.rows[0]?.world_id;
      if (wid) fastify.broadcast(wid, { type: "agent-updated", id });
      return { ok: true };
    },
  );
}
