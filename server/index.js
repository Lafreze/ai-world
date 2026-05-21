import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";

import { authPlugin } from "./auth.js";
import authRoutes from "./routes/auth.js";
import worldRoutes from "./routes/world.js";
import agentsRoutes from "./routes/agents.js";
import { startSimulation, stopSimulation } from "./sim/tick.js";
import { runMigrationsWithRetry } from "./db/migrate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fastify = Fastify({ logger: { level: "info" } });

await fastify.register(cors, { origin: true });
await fastify.register(jwt, {
  secret: process.env.JWT_SECRET || "dev-secret-change-me",
});
await fastify.register(websocket);

await fastify.register(authPlugin);

// --- WebSocket broadcast registry ---
const sockets = new Map(); // worldId -> Set<WebSocket>
function broadcast(worldId, msg) {
  const set = sockets.get(worldId);
  if (!set) return;
  const data = JSON.stringify(msg);
  for (const ws of set) {
    if (ws.readyState === 1) {
      try {
        ws.send(data);
      } catch {
        /* ignore */
      }
    }
  }
}
fastify.decorate("broadcast", broadcast);

fastify.get("/live/:worldId", { websocket: true }, (conn, req) => {
  const worldId = parseInt(req.params.worldId, 10);
  if (!sockets.has(worldId)) sockets.set(worldId, new Set());
  const set = sockets.get(worldId);
  set.add(conn.socket);
  conn.socket.on("close", () => set.delete(conn.socket));
  conn.socket.send(JSON.stringify({ type: "hello", worldId }));
});

// --- Routes ---
await fastify.register(authRoutes);
await fastify.register(worldRoutes);
await fastify.register(agentsRoutes);

// --- Static client ---
await fastify.register(staticPlugin, {
  root: path.resolve(__dirname, "../client"),
  prefix: "/",
});

fastify.get("/healthz", async () => ({ ok: true }));

const port = parseInt(process.env.PORT || "3000", 10);
await fastify.listen({ port, host: "0.0.0.0" });
fastify.log.info(`server up on :${port}`);

// Run migrations + start sim in the background so healthcheck isn't blocked
// by a slow DB cold-start.
(async () => {
  if (process.env.SKIP_MIGRATIONS === "1") {
    fastify.log.info("[boot] SKIP_MIGRATIONS=1, not running migrations");
  } else {
    const ok = await runMigrationsWithRetry();
    if (!ok) {
      fastify.log.error(
        "[boot] migrations failed; server is running but DB is unavailable",
      );
    }
  }
  if (process.env.DISABLE_SIM !== "1") {
    startSimulation(fastify);
  }
})();

const shutdown = async () => {
  stopSimulation();
  await fastify.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
