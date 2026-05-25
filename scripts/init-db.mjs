import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const conn =
  process.env.DATABASE_URL ||
  (process.env.DB_USER && process.env.DB_PASSWORD
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD)}@${process.env.DB_HOST}:${process.env.DB_PORT || 26257}/${process.env.DB_NAME || "defaultdb"}?sslmode=verify-full`
    : null);

if (!conn) {
  console.error("Set DATABASE_URL or DB_USER/DB_PASSWORD/DB_HOST");
  process.exit(1);
}

const ssl = process.env.DB_CA_CERT
  ? { ca: process.env.DB_CA_CERT.replace(/\\n/g, "\n"), rejectUnauthorized: true }
  : process.env.PGSSLROOTCERT
    ? { ca: fs.readFileSync(process.env.PGSSLROOTCERT).toString() }
    : { rejectUnauthorized: false };

const pool = new pg.Pool({ connectionString: conn, ssl });
const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
const statements = schema
  .split(";")
  .map((s) => s.replace(/--[^\n]*/g, "").trim())
  .filter((s) => s.length > 0);

try {
  for (const statement of statements) {
    await pool.query(statement);
  }
  const db = await pool.query("SELECT current_database() AS database");
  console.log("Connected database:", db.rows[0]?.database);
  const caseLink =
    process.env.CASE_LINK ||
    "https://drive.google.com/file/d/119MYxnOduI2LWv5N4gAowNnpPSr6xnjy/view?usp=sharing";
  const instructions =
    process.env.MARKING_INSTRUCTIONS ||
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
     ON CONFLICT (id) DO UPDATE SET case_link = EXCLUDED.case_link, instructions = EXCLUDED.instructions`,
    [caseLink, instructions]
  );
  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
    await pool.query(
      `INSERT INTO admins (username, password_hash) VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [process.env.ADMIN_USERNAME, hash]
    );
    console.log("Admin user ensured:", process.env.ADMIN_USERNAME);
  }
  console.log("Database initialized successfully.");
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await pool.end();
}
