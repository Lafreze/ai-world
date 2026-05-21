import { query, pool } from "../db/index.js";

const VALID_TERRAIN = new Set([
  "grass",
  "path",
  "dirt",
  "water",
  "stone",
  "sand",
  "snow",
]);
const VALID_KIND = new Set([
  null,
  "house",
  "tree",
  "rock",
  "bridge",
  "flower",
  "bush",
]);

export default async function worldRoutes(fastify) {
  // List worlds
  fastify.get("/api/worlds", async () => {
    const r = await query(
      `SELECT id, name, grid_size, owner_id, created_at, updated_at FROM worlds ORDER BY id ASC`,
    );
    return { worlds: r.rows };
  });

  // Get full world (public read)
  fastify.get("/api/worlds/:id", async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const wr = await query(
      `SELECT id, name, grid_size FROM worlds WHERE id=$1`,
      [id],
    );
    if (wr.rows.length === 0)
      return reply.code(404).send({ error: "not found" });
    const cr = await query(
      `SELECT x, z, terrain, kind, floors, terrain_floors, extras, appearance FROM cells WHERE world_id=$1`,
      [id],
    );
    const ar = await query(
      `SELECT id, name, x, z, facing, appearance, attributes, last_action, last_thought FROM agents WHERE world_id=$1`,
      [id],
    );
    return { world: wr.rows[0], cells: cr.rows, agents: ar.rows };
  });

  // Admin: batch upsert cells
  fastify.post(
    "/api/worlds/:id/cells",
    { preHandler: fastify.adminRequired },
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      const cells = Array.isArray(req.body?.cells) ? req.body.cells : null;
      if (!cells)
        return reply.code(400).send({ error: "cells array required" });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const c of cells) {
          const {
            x,
            z,
            terrain = "grass",
            kind = null,
            floors = 1,
            terrain_floors = 1,
          } = c;
          if (!Number.isInteger(x) || !Number.isInteger(z)) continue;
          if (!VALID_TERRAIN.has(terrain)) continue;
          if (!VALID_KIND.has(kind)) continue;

          // If the cell is default grass with no object, delete it (sparse storage).
          if (
            terrain === "grass" &&
            kind === null &&
            floors === 1 &&
            terrain_floors === 1
          ) {
            await client.query(
              `DELETE FROM cells WHERE world_id=$1 AND x=$2 AND z=$3`,
              [id, x, z],
            );
          } else {
            await client.query(
              `INSERT INTO cells (world_id, x, z, terrain, kind, floors, terrain_floors)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (world_id, x, z) DO UPDATE
               SET terrain=EXCLUDED.terrain, kind=EXCLUDED.kind,
                   floors=EXCLUDED.floors, terrain_floors=EXCLUDED.terrain_floors`,
              [id, x, z, terrain, kind, floors, terrain_floors],
            );
          }
        }
        await client.query(`UPDATE worlds SET updated_at=NOW() WHERE id=$1`, [
          id,
        ]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }

      fastify.broadcast(id, { type: "cells-updated", count: cells.length });
      return { ok: true, count: cells.length };
    },
  );

  // Admin: clear world
  fastify.delete(
    "/api/worlds/:id/cells",
    { preHandler: fastify.adminRequired },
    async (req) => {
      const id = parseInt(req.params.id, 10);
      await query(`DELETE FROM cells WHERE world_id=$1`, [id]);
      fastify.broadcast(id, { type: "world-cleared" });
      return { ok: true };
    },
  );
}
