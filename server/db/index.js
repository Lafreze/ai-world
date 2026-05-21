import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn("[db] DATABASE_URL is not set");
}

// SSL handling:
// - PGSSL=disable  → no SSL
// - PGSSL=require  → SSL with rejectUnauthorized:false (good for managed PG)
// - URL contains  sslmode=require → SSL with rejectUnauthorized:false
// - otherwise → let pg infer (no SSL)
function resolveSSL() {
  if (process.env.PGSSL === "disable") return false;
  if (process.env.PGSSL === "require") return { rejectUnauthorized: false };
  if (connectionString && /[?&]sslmode=require/i.test(connectionString)) {
    return { rejectUnauthorized: false };
  }
  return false;
}

export const pool = new Pool({
  connectionString,
  ssl: resolveSSL(),
  // Short connect timeout so healthchecks aren't blocked by hung connections.
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 10,
});

pool.on("error", (err) => {
  console.warn("[db] pool error:", err.code || err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}
