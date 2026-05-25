import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import JSZip from "jszip";
import { getPool } from "./utils/db";
import {
  checkPassword,
  hashPassword,
  parseBearer,
  signToken,
  verifyToken,
  type TokenPayload,
} from "./utils/auth";
import {
  CRITERIA,
  FEEDBACK_COLUMNS,
  SCORE_COLUMNS,
  SCORE_SUM_SQL,
  validateScores,
} from "./utils/criteria";
import { buildTeamScorecardPdf } from "./utils/pdf-export";
import { ensureSchema, getDbStatus } from "./utils/migrate";
import {
  driveEmbedUrl,
  extractDriveFileId,
  fetchDrivePublicFile,
} from "./utils/drive";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

function json(status: number, body: unknown) {
  return { statusCode: status, headers, body: JSON.stringify(body) };
}

function documentBinary(data: Uint8Array, contentType: string) {
  const isPdf =
    contentType.includes("pdf") || (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46);
  return {
    statusCode: 200,
    headers: {
      ...headers,
      "Content-Type": isPdf ? "application/pdf" : contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300",
    },
    body: Buffer.from(data).toString("base64"),
    isBase64Encoded: true,
  };
}

function documentFallback(link: string, message: string) {
  return json(200, {
    fallback: true,
    embed_url: driveEmbedUrl(link),
    message,
  });
}

function isPdfBytes(data: Uint8Array, contentType: string): boolean {
  if (contentType.includes("pdf")) return true;
  return data.length >= 4 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46;
}

async function streamDriveLink(link: string) {
  const fileId = extractDriveFileId(link);
  if (!fileId) {
    return json(400, {
      error: /\/folders\//i.test(link)
        ? "Folder links cannot be previewed. Use a direct file link for each submission."
        : "Invalid Google Drive link.",
    });
  }
  const result = await fetchDrivePublicFile(fileId);
  if (!result.ok) {
    if (result.code === "too_large") {
      return documentFallback(link, result.error);
    }
    return json(403, { error: result.error });
  }
  if (!isPdfBytes(result.data, result.contentType)) {
    return documentFallback(
      link,
      "This file is not a PDF. Showing Google Drive preview — ensure the file is shared with “Anyone with the link”."
    );
  }
  return documentBinary(result.data, result.contentType);
}

function pathParts(event: HandlerEvent): string[] {
  const raw = event.path.replace(/^\/\.netlify\/functions\/api\/?/, "").replace(/^\/api\/?/, "");
  return raw.split("/").filter(Boolean);
}

type AuthResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; response: { statusCode: number; headers: typeof headers; body: string } };

async function requireAuth(
  event: HandlerEvent,
  roles?: ("admin" | "judge")[]
): Promise<AuthResult> {
  const token = parseBearer(event.headers.authorization);
  if (!token) return { ok: false, response: json(401, { error: "Unauthorized" }) };
  const payload = verifyToken(token);
  if (!payload) return { ok: false, response: json(401, { error: "Invalid token" }) };
  if (roles && !roles.includes(payload.role)) {
    return { ok: false, response: json(403, { error: "Forbidden" }) };
  }
  return { ok: true, payload };
}

function parseLatePenalty(value: string): number {
  const n = parseInt(value.replace(/^"|"$/g, "").trim(), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function parseCsvTeams(csv: string): { name: string; link: string; late_penalty: number }[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  const teams: { name: string; link: string; late_penalty: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.match(/("([^"]|"")*"|[^,]+)/g);
    if (!parts || parts.length < 2) continue;
    const name = parts[0].replace(/^"|"$/g, "").replace(/""/g, '"').trim();
    const link = parts[1].replace(/^"|"$/g, "").replace(/""/g, '"').trim();
    const third = parts[2]?.replace(/^"|"$/g, "").replace(/""/g, '"').trim() || "0";
    if (
      i === 0 &&
      /team|name/i.test(name) &&
      /link|pdf|drive/i.test(link) &&
      /late|penalty/i.test(third)
    ) {
      continue;
    }
    if (name && link) {
      teams.push({ name, link, late_penalty: parseLatePenalty(third) });
    }
  }
  return teams;
}

const TEAM_IMPORT_BATCH = 100;

async function upsertTeamsBatch(
  pool: ReturnType<typeof getPool>,
  teams: { name: string; link: string; late_penalty: number }[]
): Promise<number> {
  if (!teams.length) return 0;
  const r = await pool.query(
    `INSERT INTO teams (name, pdf_drive_link, late_penalty)
     SELECT u.name, u.link, u.penalty
     FROM UNNEST($1::text[], $2::text[], $3::int[]) AS u(name, link, penalty)
     ON CONFLICT (name) DO UPDATE SET
       pdf_drive_link = EXCLUDED.pdf_drive_link,
       late_penalty = EXCLUDED.late_penalty
     RETURNING id`,
    [
      teams.map((t) => t.name),
      teams.map((t) => t.link),
      teams.map((t) => t.late_penalty),
    ]
  );
  return r.rowCount ?? 0;
}

const handler: Handler = async (event: HandlerEvent, _ctx: HandlerContext) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  const parts = pathParts(event);
  const method = event.httpMethod;
  const pool = getPool();

  try {
    await ensureSchema(pool);
    // POST /api/auth/login
    if (parts[0] === "auth" && parts[1] === "login" && method === "POST") {
      const { username, password, role } = JSON.parse(event.body || "{}");
      if (!username || !password) return json(400, { error: "Username and password required" });

      if (role === "admin") {
        const r = await pool.query(
          "SELECT id, username, password_hash FROM admins WHERE username = $1",
          [username]
        );
        if (!r.rows[0] || !(await checkPassword(password, r.rows[0].password_hash))) {
          return json(401, { error: "Invalid credentials" });
        }
        const token = signToken({ sub: r.rows[0].id, role: "admin", name: "Admin" });
        return json(200, { token, role: "admin", name: "Admin" });
      }

      const r = await pool.query(
        "SELECT id, username, password_hash, display_name, title FROM judges WHERE username = $1 AND is_active = true",
        [username]
      );
      if (!r.rows[0] || !(await checkPassword(password, r.rows[0].password_hash))) {
        return json(401, { error: "Invalid credentials" });
      }
      const j = r.rows[0];
      const token = signToken({ sub: j.id, role: "judge", name: j.display_name });
      return json(200, {
        token,
        role: "judge",
        name: j.display_name,
        title: j.title,
        id: j.id,
      });
    }

    // GET /api/settings (public-ish for logged in)
    if (parts[0] === "settings" && method === "GET") {
      const r = await pool.query("SELECT case_link, instructions FROM app_settings WHERE id = 1");
      return json(200, r.rows[0] || {});
    }

    // GET /api/leaderboard (judges & admin only)
    if (parts[0] === "leaderboard" && method === "GET") {
      const auth = await requireAuth(event);
      if (!auth.ok) return auth.response;

      const r = await pool.query(`
        SELECT t.id, t.name, t.pdf_drive_link, t.late_penalty,
          COUNT(DISTINCT s.judge_id) FILTER (WHERE s.is_submitted) AS judges_scored,
          ROUND(AVG(${SCORE_SUM_SQL}) FILTER (WHERE s.is_submitted), 2) AS avg_raw,
          ROUND(AVG(GREATEST(0, ${SCORE_SUM_SQL} - COALESCE(t.late_penalty, 0)))
            FILTER (WHERE s.is_submitted), 2) AS avg_total
        FROM teams t
        LEFT JOIN scores s ON s.team_id = t.id
        GROUP BY t.id, t.name, t.pdf_drive_link, t.late_penalty
        ORDER BY avg_total DESC NULLS LAST, t.name
      `);
      return json(200, { teams: r.rows });
    }

    // --- Judge routes ---
    if (parts[0] === "judge") {
      const auth = await requireAuth(event, ["judge"]);
      if (!auth.ok) return auth.response;

      const judgeId = auth.payload.sub;

      if (parts[1] === "dashboard" && method === "GET") {
        const settings = await pool.query("SELECT case_link, instructions FROM app_settings WHERE id = 1");
        const stats = await pool.query(
          `SELECT
            COUNT(*)::int AS assigned,
            COUNT(s.id) FILTER (WHERE s.is_submitted)::int AS completed
           FROM assignments a
           LEFT JOIN scores s ON s.judge_id = a.judge_id AND s.team_id = a.team_id AND s.is_submitted
           WHERE a.judge_id = $1`,
          [judgeId]
        );
        const judge = await pool.query(
          "SELECT display_name, title FROM judges WHERE id = $1",
          [judgeId]
        );
        return json(200, {
          ...judge.rows[0],
          ...stats.rows[0],
          ...settings.rows[0],
        });
      }

      if (parts[1] === "teams" && method === "GET") {
        const r = await pool.query(
          `SELECT t.id, t.name, t.pdf_drive_link, t.late_penalty,
            COALESCE(s.is_submitted, false) AS is_submitted,
            CASE WHEN s.id IS NOT NULL THEN true ELSE false END AS has_draft,
            ${SCORE_SUM_SQL} AS raw_total,
            GREATEST(0, ${SCORE_SUM_SQL} - COALESCE(t.late_penalty, 0)) AS current_total
           FROM assignments a
           JOIN teams t ON t.id = a.team_id
           LEFT JOIN scores s ON s.judge_id = a.judge_id AND s.team_id = t.id
           WHERE a.judge_id = $1
           ORDER BY is_submitted ASC, t.name`,
          [judgeId]
        );
        return json(200, { teams: r.rows });
      }

      if (parts[1] === "team" && parts[2] && parts[3] === "document" && method === "GET") {
        const teamId = parts[2];
        const r = await pool.query(
          `SELECT t.pdf_drive_link
           FROM assignments a
           JOIN teams t ON t.id = a.team_id
           WHERE a.judge_id = $1 AND a.team_id = $2`,
          [judgeId, teamId]
        );
        if (!r.rows[0]) return json(404, { error: "Team not assigned" });
        return streamDriveLink(String(r.rows[0].pdf_drive_link || ""));
      }

      if (parts[1] === "case-document" && method === "GET") {
        const settings = await pool.query("SELECT case_link FROM app_settings WHERE id = 1");
        const link = String(settings.rows[0]?.case_link || "");
        if (!link) return json(404, { error: "Case document not configured" });
        return streamDriveLink(link);
      }

      if (parts[1] === "team" && parts[2] && method === "GET") {
        const teamId = parts[2];
        const r = await pool.query(
          `SELECT t.*, s.*
           FROM assignments a
           JOIN teams t ON t.id = a.team_id
           LEFT JOIN scores s ON s.judge_id = a.judge_id AND s.team_id = t.id
           WHERE a.judge_id = $1 AND a.team_id = $2`,
          [judgeId, teamId]
        );
        if (!r.rows[0]) return json(404, { error: "Team not assigned" });
        return json(200, { team: r.rows[0] });
      }

      if (parts[1] === "team" && parts[2] && method === "POST") {
        const teamId = parts[2];
        const body = JSON.parse(event.body || "{}");
        const err = validateScores(body);
        if (err) return json(400, { error: err });

        const isSubmitted = Boolean(body.submit);
        const teamFeedback = String(body.team_feedback || "").trim();
        if (isSubmitted && !teamFeedback) {
          return json(400, { error: "Overall team feedback is required when submitting marks" });
        }

        const assigned = await pool.query(
          "SELECT 1 FROM assignments WHERE judge_id = $1 AND team_id = $2",
          [judgeId, teamId]
        );
        if (!assigned.rows[0]) return json(403, { error: "Not assigned to this team" });

        const feedbackVals = CRITERIA.map((c) => String(body[`feedback_${c.key}`] || ""));

        const scoreVals = CRITERIA.map((c) => Number(body[c.key]) || 0);

        await pool.query(
          `INSERT INTO scores (
            judge_id, team_id,
            ${SCORE_COLUMNS.join(", ")},
            ${FEEDBACK_COLUMNS.join(", ")},
            team_feedback, is_submitted, updated_at
          ) VALUES (
            $1, $2,
            ${SCORE_COLUMNS.map((_, idx) => `$${idx + 3}`).join(", ")},
            ${FEEDBACK_COLUMNS.map((_, idx) => `$${idx + 3 + SCORE_COLUMNS.length}`).join(", ")},
            $${3 + SCORE_COLUMNS.length + FEEDBACK_COLUMNS.length},
            $${4 + SCORE_COLUMNS.length + FEEDBACK_COLUMNS.length},
            now()
          )
          ON CONFLICT (judge_id, team_id) DO UPDATE SET
            ${SCORE_COLUMNS.map((c) => `${c} = EXCLUDED.${c}`).join(", ")},
            ${FEEDBACK_COLUMNS.map((c) => `${c} = EXCLUDED.${c}`).join(", ")},
            team_feedback = EXCLUDED.team_feedback,
            is_submitted = EXCLUDED.is_submitted,
            updated_at = now()`,
          [
            judgeId,
            teamId,
            ...scoreVals,
            ...feedbackVals,
            teamFeedback,
            isSubmitted,
          ]
        );

        return json(200, { ok: true, submitted: isSubmitted });
      }
    }

    // --- Admin routes ---
    if (parts[0] === "admin") {
      const auth = await requireAuth(event, ["admin"]);
      if (!auth.ok) return auth.response;

      if (parts[1] === "db-status" && method === "GET") {
        const status = await getDbStatus(pool);
        return json(200, status);
      }

      if (parts[1] === "stats" && method === "GET") {
        const r = await pool.query(`
          SELECT
            (SELECT COUNT(*)::int FROM teams) AS teams,
            (SELECT COUNT(*)::int FROM judges WHERE is_active) AS judges,
            (SELECT COUNT(*)::int FROM assignments) AS assignments,
            (SELECT COUNT(*)::int FROM scores WHERE is_submitted) AS submissions
        `);
        return json(200, r.rows[0]);
      }

      if (parts[1] === "teams" && method === "GET") {
        const r = await pool.query(`
          SELECT t.id, t.name, t.pdf_drive_link, t.late_penalty,
            COUNT(DISTINCT a.judge_id)::int AS judges_assigned,
            COUNT(DISTINCT s.judge_id) FILTER (WHERE s.is_submitted)::int AS judges_scored
          FROM teams t
          LEFT JOIN assignments a ON a.team_id = t.id
          LEFT JOIN scores s ON s.team_id = t.id AND s.is_submitted
          GROUP BY t.id, t.name, t.pdf_drive_link, t.late_penalty
          ORDER BY t.name
        `);
        return json(200, { teams: r.rows });
      }

      if (parts[1] === "teams" && parts[2] === "import" && method === "POST") {
        const { csv } = JSON.parse(event.body || "{}");
        if (!csv) return json(400, { error: "CSV required" });
        const teams = parseCsvTeams(csv);
        if (!teams.length) return json(400, { error: "No valid teams found in CSV" });
        let upserted = 0;
        for (let i = 0; i < teams.length; i += TEAM_IMPORT_BATCH) {
          const batch = teams.slice(i, i + TEAM_IMPORT_BATCH);
          upserted += await upsertTeamsBatch(pool, batch);
        }
        return json(200, { imported: teams.length, upserted });
      }

      if (parts[1] === "teams" && parts[2] === "all" && method === "DELETE") {
        const del = await pool.query("DELETE FROM teams");
        return json(200, { ok: true, deleted: del.rowCount ?? 0 });
      }

      if (
        parts[1] === "teams" &&
        parts[2] &&
        parts[2] !== "import" &&
        method === "DELETE"
      ) {
        const teamId = parts[2];
        const del = await pool.query("DELETE FROM teams WHERE id = $1 RETURNING id", [teamId]);
        if (!del.rows[0]) return json(404, { error: "Team not found" });
        return json(200, { ok: true });
      }

      if (parts[1] === "judges" && method === "GET") {
        const r = await pool.query(`
          SELECT j.id, j.username, j.display_name, j.title, j.is_active,
            COUNT(a.id)::int AS assigned,
            COUNT(s.id) FILTER (WHERE s.is_submitted)::int AS completed
          FROM judges j
          LEFT JOIN assignments a ON a.judge_id = j.id
          LEFT JOIN scores s ON s.judge_id = j.id AND s.is_submitted
          GROUP BY j.id ORDER BY j.display_name
        `);
        return json(200, { judges: r.rows });
      }

      if (parts[1] === "assignments" && method === "GET") {
        const r = await pool.query(`
          SELECT a.id, a.judge_id, a.team_id,
            j.display_name AS judge_name, t.name AS team_name,
            CASE WHEN s.id IS NOT NULL THEN true ELSE false END AS has_score,
            COALESCE(s.is_submitted, false) AS is_submitted
          FROM assignments a
          JOIN judges j ON j.id = a.judge_id
          JOIN teams t ON t.id = a.team_id
          LEFT JOIN scores s ON s.judge_id = a.judge_id AND s.team_id = a.team_id
          ORDER BY j.display_name, t.name
        `);
        return json(200, { assignments: r.rows });
      }

      if (parts[1] === "assignments" && parts[2] && method === "DELETE") {
        const assignmentId = parts[2];
        const row = await pool.query(
          "SELECT judge_id, team_id FROM assignments WHERE id = $1",
          [assignmentId]
        );
        if (!row.rows[0]) return json(404, { error: "Assignment not found" });
        const { judge_id, team_id } = row.rows[0];
        await pool.query(
          "DELETE FROM scores WHERE judge_id = $1 AND team_id = $2",
          [judge_id, team_id]
        );
        const del = await pool.query("DELETE FROM assignments WHERE id = $1", [assignmentId]);
        if (!del.rowCount) return json(404, { error: "Assignment not found" });
        return json(200, { ok: true });
      }

      if (parts[1] === "scores" && method === "DELETE") {
        const body = event.body ? JSON.parse(event.body) : {};
        const judgeId = body.judge_id || event.queryStringParameters?.judge_id;
        const teamId = body.team_id || event.queryStringParameters?.team_id;
        if (!judgeId || !teamId) {
          return json(400, { error: "judge_id and team_id required" });
        }
        const del = await pool.query(
          "DELETE FROM scores WHERE judge_id = $1 AND team_id = $2",
          [judgeId, teamId]
        );
        return json(200, { ok: true, deleted: del.rowCount });
      }

      if (parts[1] === "judges" && parts[2] && method === "DELETE") {
        const judgeId = parts[2];
        const del = await pool.query("DELETE FROM judges WHERE id = $1 RETURNING id", [judgeId]);
        if (!del.rows[0]) return json(404, { error: "Judge not found" });
        return json(200, { ok: true });
      }

      if (parts[1] === "judges" && parts[2] === "bulk" && method === "POST") {
        const { judges: list } = JSON.parse(event.body || "{}");
        if (!Array.isArray(list)) return json(400, { error: "judges array required" });
        const created: { id: string; username: string; display_name: string }[] = [];
        for (let i = 0; i < list.length; i++) {
          const j = list[i];
          if (!j?.username || !j?.password || !j?.display_name) {
            return json(400, {
              error: `Line ${i + 1}: username, password, and display name are required`,
            });
          }
          const hash = await hashPassword(j.password);
          const r = await pool.query(
            `INSERT INTO judges (username, password_hash, display_name, title)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (username) DO UPDATE SET
               password_hash = EXCLUDED.password_hash,
               display_name = EXCLUDED.display_name,
               title = EXCLUDED.title
             RETURNING id, username, display_name`,
            [j.username, hash, j.display_name, j.title || ""]
          );
          created.push(r.rows[0]);
        }
        return json(200, { created });
      }

      if (parts[1] === "judges" && !parts[2] && method === "POST") {
        const { username, password, display_name, title } = JSON.parse(event.body || "{}");
        if (!username || !password || !display_name) {
          return json(400, { error: "username, password, display_name required" });
        }
        const hash = await hashPassword(password);
        const r = await pool.query(
          `INSERT INTO judges (username, password_hash, display_name, title)
           VALUES ($1, $2, $3, $4) RETURNING id, username, display_name, title`,
          [username, hash, display_name, title || ""]
        );
        return json(201, { judge: r.rows[0] });
      }

      if (parts[1] === "assign" && parts[2] === "random" && method === "POST") {
        const { judge_id, count } = JSON.parse(event.body || "{}");
        if (!judge_id || !count) return json(400, { error: "judge_id and count required" });

        const unassigned = await pool.query(
          `SELECT t.id FROM teams t
           WHERE NOT EXISTS (
             SELECT 1 FROM assignments a WHERE a.team_id = t.id AND a.judge_id = $1
           )
           ORDER BY random() LIMIT $2`,
          [judge_id, count]
        );
        for (const row of unassigned.rows) {
          await pool.query(
            `INSERT INTO assignments (judge_id, team_id) VALUES ($1, $2)
             ON CONFLICT (judge_id, team_id) DO NOTHING`,
            [judge_id, row.id]
          );
        }
        return json(200, { assigned: unassigned.rows.length });
      }

      if (parts[1] === "assign" && parts[2] === "bulk" && method === "POST") {
        const { judge_id, team_ids } = JSON.parse(event.body || "{}");
        if (!judge_id || !Array.isArray(team_ids)) {
          return json(400, { error: "judge_id and team_ids required" });
        }
        let n = 0;
        for (const tid of team_ids) {
          const res = await pool.query(
            `INSERT INTO assignments (judge_id, team_id) VALUES ($1, $2)
             ON CONFLICT (judge_id, team_id) DO NOTHING`,
            [judge_id, tid]
          );
          if (res.rowCount) n++;
        }
        return json(200, { assigned: n });
      }

      if (parts[1] === "assign" && parts[2] === "auto-distribute" && method === "POST") {
        const { per_judge } = JSON.parse(event.body || "{}");
        const n = Number(per_judge) || 20;
        const judges = await pool.query("SELECT id FROM judges WHERE is_active ORDER BY display_name");
        const teams = await pool.query("SELECT id FROM teams ORDER BY random()");
        let ti = 0;
        let total = 0;
        for (const j of judges.rows) {
          const existing = await pool.query(
            "SELECT COUNT(*)::int AS c FROM assignments WHERE judge_id = $1",
            [j.id]
          );
          let need = n - (existing.rows[0]?.c || 0);
          while (need > 0 && ti < teams.rows.length) {
            const res = await pool.query(
              `INSERT INTO assignments (judge_id, team_id) VALUES ($1, $2)
               ON CONFLICT DO NOTHING RETURNING id`,
              [j.id, teams.rows[ti].id]
            );
            ti++;
            if (res.rows[0]) {
              need--;
              total++;
            }
          }
        }
        return json(200, { assigned: total, per_judge: n });
      }

      if (parts[1] === "export" && parts[2] === "scorecards" && method === "GET") {
        const teams = await pool.query(
          "SELECT id, name, late_penalty FROM teams ORDER BY name"
        );
        const zip = new JSZip();

        for (const team of teams.rows) {
          const scores = await pool.query(
            `SELECT j.display_name AS judge_name, s.*
             FROM scores s
             JOIN judges j ON j.id = s.judge_id
             WHERE s.team_id = $1 AND s.is_submitted
             ORDER BY j.display_name`,
            [team.id]
          );
          if (!scores.rows.length) continue;
          const pdf = await buildTeamScorecardPdf(
            team.name,
            Number(team.late_penalty) || 0,
            scores.rows.map((r) => ({
              judgeName: r.judge_name,
              row: r,
            }))
          );
          const safe = team.name.replace(/[^\w\s-]/g, "").slice(0, 80);
          zip.file(`${safe}-scorecard.pdf`, pdf);
        }

        const blob = await zip.generateAsync({ type: "base64" });
        return {
          statusCode: 200,
          headers: {
            ...headers,
            "Content-Type": "application/zip",
            "Content-Disposition": 'attachment; filename="scorecards.zip"',
          },
          body: blob,
          isBase64Encoded: true,
        };
      }

      if (parts[1] === "settings" && method === "PUT") {
        const { case_link, instructions } = JSON.parse(event.body || "{}");
        await pool.query(
          `INSERT INTO app_settings (id, case_link, instructions) VALUES (1, $1, $2)
           ON CONFLICT (id) DO UPDATE SET case_link = $1, instructions = $2, updated_at = now()`,
          [case_link, instructions]
        );
        return json(200, { ok: true });
      }
    }

    return json(404, { error: "Not found", path: parts.join("/") });
  } catch (e) {
    console.error(e);
    return json(500, { error: e instanceof Error ? e.message : "Server error" });
  }
};

export { handler };
