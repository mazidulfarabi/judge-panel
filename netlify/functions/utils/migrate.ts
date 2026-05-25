import type pg from "pg";
import { hashPassword } from "./auth";
import { env } from "./env";
import { SCHEMA_SQL } from "./schema-sql";

let initPromise: Promise<void> | null = null;

async function runInit(pool: pg.Pool): Promise<void> {
  const exists = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'admins'
     ) AS ok`
  );
  if (exists.rows[0]?.ok) return;

  await pool.query(SCHEMA_SQL);

  const caseLink =
    env("CASE_LINK") ||
    "https://drive.google.com/file/d/119MYxnOduI2LWv5N4gAowNnpPSr6xnjy/view?usp=sharing";
  const instructions =
    env("MARKING_INSTRUCTIONS") ||
    "Please do accurate marking. Try to avoid leniency, strictness, or central tendency (all teams getting similar marks).";

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

  console.log("Database schema initialized.");
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
