import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn("[db] DATABASE_URL is not set");
}

export const pool = new Pool({
  connectionString,
  ssl:
    process.env.PGSSL === "disable"
      ? false
      : connectionString &&
          /railway|amazonaws|render|supabase/i.test(connectionString)
        ? { rejectUnauthorized: false }
        : false,
});

export function query(text, params) {
  return pool.query(text, params);
}
