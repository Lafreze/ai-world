import bcrypt from "bcryptjs";
import { query } from "../db/index.js";

export default async function authRoutes(fastify) {
  fastify.post("/api/auth/register", async (req, reply) => {
    const { username, password } = req.body || {};
    if (!username || !password || password.length < 6) {
      return reply.code(400).send({ error: "invalid input" });
    }
    const hash = await bcrypt.hash(password, 10);
    try {
      const r = await query(
        `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'user') RETURNING id, username, role`,
        [username, hash],
      );
      const u = r.rows[0];
      const token = fastify.jwt.sign({
        id: u.id,
        username: u.username,
        role: u.role,
      });
      return { token, user: u };
    } catch (e) {
      if (e.code === "23505")
        return reply.code(409).send({ error: "username taken" });
      throw e;
    }
  });

  fastify.post("/api/auth/login", async (req, reply) => {
    const { username, password } = req.body || {};
    if (!username || !password)
      return reply.code(400).send({ error: "invalid input" });
    const r = await query(
      `SELECT id, username, password_hash, role FROM users WHERE username=$1`,
      [username],
    );
    const u = r.rows[0];
    if (!u || !(await bcrypt.compare(password, u.password_hash))) {
      return reply.code(401).send({ error: "bad credentials" });
    }
    const token = fastify.jwt.sign({
      id: u.id,
      username: u.username,
      role: u.role,
    });
    return { token, user: { id: u.id, username: u.username, role: u.role } };
  });

  fastify.get(
    "/api/auth/me",
    { preHandler: fastify.authRequired },
    async (req) => {
      return { user: req.user };
    },
  );
}
