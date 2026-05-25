import pg from "pg";
import { env } from "./env";

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;

  const conn = env("DATABASE_URL");
  if (!conn) {
    throw new Error("DATABASE_URL is not configured");
  }

  const caCert = env("DB_CA_CERT");
  const sslConfig: pg.ConnectionConfig["ssl"] = caCert
    ? {
        ca: caCert.replace(/\\n/g, "\n"),
        rejectUnauthorized: true,
      }
    : { rejectUnauthorized: false };

  pool = new pg.Pool({
    connectionString: conn,
    ssl: sslConfig,
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  });

  return pool;
}
