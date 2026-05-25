import type pg from "pg";
import { hashPassword } from "./auth";
import { env } from "./env";
import { SCHEMA_SQL } from "./schema-sql";

let initPromise: Promise<void> | null = null;

function schemaStatements(): string[] {
  return SCHEMA_SQL.split(";")
    .map((s) => s.replace(/--[^\n]*/g, "").trim())
    .filter((s) => s.length > 0);
}

async function adminsTableExists(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query("SELECT 1 FROM public.admins LIMIT 1");
    return true;
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "42P01") return false;
    throw e;
  }
}

async function runInit(pool: pg.Pool): Promise<void> {
  if (await adminsTableExists(pool)) return;

  for (const statement of schemaStatements()) {
    await pool.query(statement);
  }

  const dbInfo = await pool.query(
    "SELECT current_database() AS db, current_schema() AS schema"
  );
  console.log("Database schema initialized.", dbInfo.rows[0]);

  const caseLink =
    env("CASE_LINK") ||
    "https://drive.google.com/file/d/119MYxnOduI2LWv5N4gAowNnpPSr6xnjy/view?usp=sharing";
  const instructions =
    env("MARKING_INSTRUCTIONS") ||
    `Please complete all your assigned teams by 2nd June 2026.

Marking criteria (100 points total):
• Situation Analysis — 10 pts
• Problem Analysis — 10 pts
• Target Group Analysis — 5 pts
• Branding Justification — 10 pts
• Big Idea — 15 pts
• Marketing Strategy — 15 pts
• Feasibility — 10 pts
• Financials & Timeline — 5 pts
• Monitoring & Evaluation — 5 pts
• Idea Creativity — 15 pts

Please mark accurately. Avoid leniency, strictness, or central tendency. Score each criterion independently.`;

  await pool.query(
    `INSERT INTO app_settings (id, case_link, instructions) VALUES (1, $1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [caseLink, instructions]
  );

  const adminUser = env("ADMIN_USERNAME");
  const adminPass = env("ADMIN_PASSWORD");
  if (adminUser && adminPass) {
    const hash = await hashPassword(adminPass);
    await pool.query(
      `INSERT INTO admins (username, password_hash) VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [adminUser, hash]
    );
  }
}

/** Create tables + seed admin on first API call if schema is missing. */
export function ensureSchema(pool: pg.Pool): Promise<void> {
  if (!initPromise) {
    initPromise = runInit(pool).catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export async function getDbStatus(pool: pg.Pool) {
  await ensureSchema(pool);
  const db = await pool.query("SELECT current_database() AS database");
  const tables = await pool.query(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'crdb_internal')
       AND table_type = 'BASE TABLE'
     ORDER BY table_schema, table_name`
  );
  const counts = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM judges) AS judges,
      (SELECT COUNT(*)::int FROM teams) AS teams,
      (SELECT COUNT(*)::int FROM admins) AS admins
  `);
  return {
    connected: db.rows[0],
    tables: tables.rows,
    counts: counts.rows[0],
  };
}
