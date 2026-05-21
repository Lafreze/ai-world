export async function authPlugin(fastify) {
  fastify.decorate("authRequired", async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  fastify.decorate("adminRequired", async (req, reply) => {
    try {
      await req.jwtVerify();
      if (req.user?.role !== "admin") {
        reply.code(403).send({ error: "admin only" });
      }
    } catch {
      reply.code(401).send({ error: "unauthorized" });
    }
  });
}
