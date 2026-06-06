import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
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
import { buildAllFeedbackPdf, buildFeedbackExportData } from "./utils/feedback-pdf";
import { ensureSchema, getDbStatus } from "./utils/migrate";
import {
  driveEmbedUrl,
  extractDriveFileId,
  fetchDrivePublicFile,
} from "./utils/drive";
import { assignUniqueTeamNames } from "../../shared/team-import";

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
const ASSIGNMENT_BATCH = 100;

type DuplicateAssignmentRow = {
  assignment_id: string;
  team_id: string;
  team_name: string;
  judge_name: string;
  assigned_at: string;
  keeps_assignment: boolean;
};

async function fetchDuplicateAssignments(
  pool: ReturnType<typeof getPool>
): Promise<DuplicateAssignmentRow[]> {
  const r = await pool.query(`
    SELECT a.id AS assignment_id, a.team_id, t.name AS team_name,
      j.display_name AS judge_name, a.assigned_at,
      (ROW_NUMBER() OVER (
        PARTITION BY a.team_id ORDER BY a.assigned_at ASC, a.id
      ) = 1) AS keeps_assignment
    FROM assignments a
    INNER JOIN teams t ON t.id = a.team_id
    INNER JOIN judges j ON j.id = a.judge_id
    WHERE a.team_id IN (
      SELECT a2.team_id FROM assignments a2
      INNER JOIN teams t2 ON t2.id = a2.team_id
      GROUP BY a2.team_id HAVING COUNT(*) > 1
    )
    ORDER BY t.name, a.assigned_at
  `);
  return r.rows as DuplicateAssignmentRow[];
}

/** If set, this team already has a judge (one judge per team). */
async function teamAssignedJudgeId(
  pool: ReturnType<typeof getPool>,
  teamId: string
): Promise<string | null> {
  const r = await pool.query(
    `SELECT a.judge_id FROM assignments a
     INNER JOIN teams t ON t.id = a.team_id
     WHERE a.team_id = $1
     LIMIT 1`,
    [teamId]
  );
  return (r.rows[0]?.judge_id as string) ?? null;
}

/** Remove assignment/score rows whose team no longer exists (stale after team delete). */
async function purgeOrphanAssignmentData(pool: ReturnType<typeof getPool>): Promise<void> {
  await pool.query(
    `DELETE FROM scores s
     WHERE NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = s.team_id)`
  );
  await pool.query(
    `DELETE FROM assignments a
     WHERE NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = a.team_id)`
  );
}

async function insertAssignmentsBatch(
  pool: ReturnType<typeof getPool>,
  pairs: { judge_id: string; team_id: string }[]
): Promise<number> {
  if (!pairs.length) return 0;
  let inserted = 0;
  for (let i = 0; i < pairs.length; i += ASSIGNMENT_BATCH) {
    const batch = pairs.slice(i, i + ASSIGNMENT_BATCH);
    const r = await pool.query(
      `INSERT INTO assignments (judge_id, team_id)
       SELECT u.judge_id, u.team_id
       FROM UNNEST($1::uuid[], $2::uuid[]) AS u(judge_id, team_id)
       ON CONFLICT (judge_id, team_id) DO NOTHING`,
      [batch.map((p) => p.judge_id), batch.map((p) => p.team_id)]
    );
    inserted += r.rowCount ?? 0;
  }
  return inserted;
}

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

    // GET /api/leaderboard/team/:id/scorecard
    if (
      parts[0] === "leaderboard" &&
      parts[1] === "team" &&
      parts[2] &&
      parts[3] === "scorecard" &&
      method === "GET"
    ) {
      const auth = await requireAuth(event);
      if (!auth.ok) return auth.response;

      const teamId = parts[2];
      const teamRes = await pool.query(
        "SELECT id, name, late_penalty FROM teams WHERE id = $1",
        [teamId]
      );
      if (!teamRes.rows[0]) return json(404, { error: "Team not found" });

      const scoresRes = await pool.query(
        `SELECT j.display_name AS judge_name, s.*
         FROM scores s
         INNER JOIN judges j ON j.id = s.judge_id
         WHERE s.team_id = $1 AND s.is_submitted
         ORDER BY j.display_name`,
        [teamId]
      );
      if (!scoresRes.rows.length) {
        return json(400, { error: "No submitted marks for this team yet." });
      }

      const avgRes = await pool.query(
        `SELECT ROUND(AVG(GREATEST(0, ${SCORE_SUM_SQL} - COALESCE(t.late_penalty, 0))), 2) AS avg_total
         FROM teams t
         INNER JOIN scores s ON s.team_id = t.id AND s.is_submitted
         WHERE t.id = $1
         GROUP BY t.id`,
        [teamId]
      );

      const team = teamRes.rows[0];
      const scoreKeys = [...SCORE_COLUMNS, ...FEEDBACK_COLUMNS, "team_feedback"];
      const judges = scoresRes.rows.map((row) => {
        const scores: Record<string, string | number> = {};
        for (const k of scoreKeys) {
          scores[k] = row[k] ?? (k.startsWith("feedback_") || k === "team_feedback" ? "" : 0);
        }
        return { judge_name: row.judge_name as string, scores };
      });

      return json(200, {
        team_name: team.name,
        late_penalty: Number(team.late_penalty) || 0,
        avg_total: avgRes.rows[0]?.avg_total != null ? Number(avgRes.rows[0].avg_total) : null,
        judges_scored: judges.length,
        judges,
      });
    }

    // GET /api/leaderboard (judges & admin only)
    if (parts[0] === "leaderboard" && method === "GET") {
      const auth = await requireAuth(event);
      if (!auth.ok) return auth.response;

      const isAdmin = auth.payload.role === "admin";
      const judgeNamesSelect = isAdmin
        ? `(SELECT STRING_AGG(j.display_name, ', ' ORDER BY j.display_name)
            FROM assignments a
            JOIN judges j ON j.id = a.judge_id
            WHERE a.team_id = t.id) AS judge_names,`
        : "";

      const r = await pool.query(`
        SELECT t.id, t.name, t.pdf_drive_link, t.late_penalty,
          ${judgeNamesSelect}
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
        await purgeOrphanAssignmentData(pool);
        const stats = await pool.query(
          `SELECT
            COUNT(*)::int AS assigned,
            COUNT(s.id) FILTER (WHERE s.is_submitted)::int AS completed
           FROM assignments a
           INNER JOIN teams t ON t.id = a.team_id
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
        const scoreCols = SCORE_COLUMNS.map((c) => `s.${c}`).join(", ");
        const feedbackCols = FEEDBACK_COLUMNS.map((c) => `s.${c}`).join(", ");
        const r = await pool.query(
          `SELECT t.id, t.name, t.pdf_drive_link, t.late_penalty,
            COALESCE(s.is_submitted, false) AS is_submitted,
            CASE WHEN s.id IS NOT NULL THEN true ELSE false END AS has_draft,
            ${SCORE_SUM_SQL} AS raw_total,
            GREATEST(0, ${SCORE_SUM_SQL} - COALESCE(t.late_penalty, 0)) AS current_total,
            s.team_feedback, ${scoreCols}, ${feedbackCols}
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
        await purgeOrphanAssignmentData(pool);
        const r = await pool.query(`
          SELECT
            (SELECT COUNT(*)::int FROM teams) AS teams,
            (SELECT COUNT(*)::int FROM judges WHERE is_active) AS judges,
            (SELECT COUNT(*)::int FROM assignments a
             WHERE EXISTS (SELECT 1 FROM teams t WHERE t.id = a.team_id)) AS assignments,
            (SELECT COUNT(DISTINCT a.team_id)::int FROM assignments a
             INNER JOIN teams t ON t.id = a.team_id) AS teams_with_judge,
            (SELECT COUNT(*)::int FROM (
               SELECT a.team_id FROM assignments a
               INNER JOIN teams t ON t.id = a.team_id
               GROUP BY a.team_id HAVING COUNT(*) > 1
             ) multi) AS teams_multi_judge,
            (SELECT COUNT(*)::int FROM scores WHERE is_submitted) AS submissions
        `);
        return json(200, r.rows[0]);
      }

      if (parts[1] === "teams" && method === "GET") {
        const r = await pool.query(`
          SELECT t.id, t.name, t.pdf_drive_link, t.late_penalty,
            (SELECT COUNT(*)::int FROM assignments a WHERE a.team_id = t.id) AS judges_assigned,
            (SELECT COUNT(*)::int FROM scores s WHERE s.team_id = t.id AND s.is_submitted) AS judges_scored,
            (SELECT STRING_AGG(j.display_name, ', ' ORDER BY j.display_name)
             FROM assignments a
             JOIN judges j ON j.id = a.judge_id
             WHERE a.team_id = t.id) AS judge_names
          FROM teams t
          ORDER BY t.name
        `);
        return json(200, { teams: r.rows });
      }

      if (parts[1] === "teams" && parts[2] === "import" && method === "POST") {
        const { csv } = JSON.parse(event.body || "{}");
        if (!csv) return json(400, { error: "CSV required" });
        const parsed = parseCsvTeams(csv);
        if (!parsed.length) return json(400, { error: "No valid teams found in CSV" });
        const { teams, renamed } = assignUniqueTeamNames(parsed);
        let upserted = 0;
        for (let i = 0; i < teams.length; i += TEAM_IMPORT_BATCH) {
          const batch = teams.slice(i, i + TEAM_IMPORT_BATCH);
          upserted += await upsertTeamsBatch(pool, batch);
        }
        return json(200, { imported: teams.length, upserted, renamed });
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
        await purgeOrphanAssignmentData(pool);
        return json(200, { ok: true });
      }

      if (parts[1] === "judges" && method === "GET") {
        await purgeOrphanAssignmentData(pool);
        const r = await pool.query(`
          SELECT j.id, j.username, j.display_name, j.title, j.is_active,
            (SELECT COUNT(*)::int FROM assignments a
             INNER JOIN teams t ON t.id = a.team_id
             WHERE a.judge_id = j.id) AS assigned,
            (SELECT COUNT(*)::int FROM scores s
             INNER JOIN teams t ON t.id = s.team_id
             WHERE s.judge_id = j.id AND s.is_submitted) AS completed
          FROM judges j
          ORDER BY j.display_name
        `);
        return json(200, { judges: r.rows });
      }

      if (parts[1] === "assignments" && parts[2] === "duplicates" && method === "GET") {
        await purgeOrphanAssignmentData(pool);
        const rows = await fetchDuplicateAssignments(pool);
        const teamsAffected = new Set(rows.map((r) => r.team_id)).size;
        const extraAssignments = rows.filter((r) => !r.keeps_assignment).length;
        return json(200, {
          teams_affected: teamsAffected,
          extra_assignments: extraAssignments,
          rows,
        });
      }

      if (parts[1] === "assignments" && method === "GET" && !parts[2]) {
        await purgeOrphanAssignmentData(pool);
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

      if (parts[1] === "assignments" && parts[2] === "all" && method === "DELETE") {
        await pool.query("DELETE FROM scores");
        const del = await pool.query("DELETE FROM assignments");
        return json(200, { deleted: del.rowCount ?? 0 });
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

      if (parts[1] === "assign" && parts[2] === "single" && method === "POST") {
        const { judge_id, team_id } = JSON.parse(event.body || "{}");
        if (!judge_id || !team_id) {
          return json(400, { error: "judge_id and team_id required" });
        }
        const judge = await pool.query("SELECT id FROM judges WHERE id = $1", [judge_id]);
        if (!judge.rows[0]) return json(404, { error: "Judge not found" });
        const team = await pool.query("SELECT id, name FROM teams WHERE id = $1", [team_id]);
        if (!team.rows[0]) return json(404, { error: "Team not found" });
        const existingJudge = await teamAssignedJudgeId(pool, team_id);
        if (existingJudge && existingJudge !== judge_id) {
          return json(409, {
            error: "This team is already assigned to another judge. Remove that assignment first.",
          });
        }
        const ins = await pool.query(
          `INSERT INTO assignments (judge_id, team_id) VALUES ($1, $2)
           ON CONFLICT (judge_id, team_id) DO NOTHING
           RETURNING id`,
          [judge_id, team_id]
        );
        if (!ins.rows[0]) {
          return json(200, {
            assigned: false,
            message: "This judge is already assigned to that team",
          });
        }
        return json(201, {
          assigned: true,
          id: ins.rows[0].id,
          judge_id,
          team_id,
          team_name: team.rows[0].name,
        });
      }

      if (parts[1] === "assign" && parts[2] === "random" && method === "POST") {
        const { judge_id, count } = JSON.parse(event.body || "{}");
        if (!judge_id || !count) return json(400, { error: "judge_id and count required" });

        const unassigned = await pool.query(
          `SELECT t.id FROM teams t
           WHERE NOT EXISTS (SELECT 1 FROM assignments a WHERE a.team_id = t.id)
           ORDER BY random() LIMIT $1`,
          [count]
        );
        let n = 0;
        for (const row of unassigned.rows) {
          const res = await pool.query(
            `INSERT INTO assignments (judge_id, team_id) VALUES ($1, $2)
             ON CONFLICT (judge_id, team_id) DO NOTHING`,
            [judge_id, row.id]
          );
          if (res.rowCount) n++;
        }
        return json(200, { assigned: n });
      }

      if (parts[1] === "assign" && parts[2] === "bulk" && method === "POST") {
        const { judge_id, team_ids } = JSON.parse(event.body || "{}");
        if (!judge_id || !Array.isArray(team_ids)) {
          return json(400, { error: "judge_id and team_ids required" });
        }
        let n = 0;
        let skipped = 0;
        for (const tid of team_ids) {
          const existingJudge = await teamAssignedJudgeId(pool, tid);
          if (existingJudge && existingJudge !== judge_id) {
            skipped++;
            continue;
          }
          const res = await pool.query(
            `INSERT INTO assignments (judge_id, team_id) VALUES ($1, $2)
             ON CONFLICT (judge_id, team_id) DO NOTHING`,
            [judge_id, tid]
          );
          if (res.rowCount) n++;
        }
        return json(200, { assigned: n, skipped });
      }

      if (parts[1] === "assignments" && parts[2] === "dedupe" && method === "POST") {
        await purgeOrphanAssignmentData(pool);
        const rowsBefore = await fetchDuplicateAssignments(pool);
        const teamsAffected = new Set(rowsBefore.map((r) => r.team_id)).size;
        const removed = await pool.query(`
          WITH ranked AS (
            SELECT a.id, a.judge_id, a.team_id,
              ROW_NUMBER() OVER (PARTITION BY a.team_id ORDER BY a.assigned_at ASC, a.id) AS rn
            FROM assignments a
            INNER JOIN teams t ON t.id = a.team_id
          ),
          to_drop AS (SELECT id, judge_id, team_id FROM ranked WHERE rn > 1)
          DELETE FROM scores s
          USING to_drop d
          WHERE s.judge_id = d.judge_id AND s.team_id = d.team_id
        `);
        const del = await pool.query(`
          WITH ranked AS (
            SELECT a.id,
              ROW_NUMBER() OVER (PARTITION BY a.team_id ORDER BY a.assigned_at ASC, a.id) AS rn
            FROM assignments a
            INNER JOIN teams t ON t.id = a.team_id
          )
          DELETE FROM assignments a
          USING ranked r
          WHERE a.id = r.id AND r.rn > 1
        `);
        const teams = [...new Set(rowsBefore.map((r) => r.team_id))].map((teamId) => {
          const teamRows = rowsBefore.filter((r) => r.team_id === teamId);
          return {
            team_id: teamId,
            team_name: teamRows[0]?.team_name ?? "",
            judges: teamRows.map((r) => r.judge_name).join(", "),
          };
        });
        return json(200, {
          removed: del.rowCount ?? 0,
          scores_cleared: removed.rowCount ?? 0,
          teams_affected: teamsAffected,
          teams,
        });
      }

      if (parts[1] === "assign" && parts[2] === "auto-distribute" && method === "POST") {
        const { per_judge } = JSON.parse(event.body || "{}");
        const n = Math.max(1, Math.floor(Number(per_judge) || 20));

        await purgeOrphanAssignmentData(pool);
        const [judgesRes, countsRes, unassignedRes] = await Promise.all([
          pool.query("SELECT id FROM judges WHERE is_active ORDER BY display_name"),
          pool.query(
            `SELECT a.judge_id, COUNT(*)::int AS c
             FROM assignments a
             INNER JOIN teams t ON t.id = a.team_id
             GROUP BY a.judge_id`
          ),
          pool.query(
            `SELECT t.id FROM teams t
             WHERE NOT EXISTS (SELECT 1 FROM assignments a WHERE a.team_id = t.id)
             ORDER BY random()`
          ),
        ]);

        if (!judgesRes.rows.length) return json(400, { error: "No active judges" });
        if (!unassignedRes.rows.length) {
          return json(200, { assigned: 0, per_judge: n, message: "All teams already have an assignment" });
        }

        const countMap = new Map<string, number>(
          countsRes.rows.map((r) => [r.judge_id as string, r.c as number])
        );
        const judgeIds = judgesRes.rows.map((r) => r.id as string);
        const pairs: { judge_id: string; team_id: string }[] = [];
        let judgeIdx = 0;

        for (const row of unassignedRes.rows) {
          const teamId = row.id as string;
          let placed = false;
          for (let attempt = 0; attempt < judgeIds.length; attempt++) {
            const judgeId = judgeIds[judgeIdx % judgeIds.length];
            judgeIdx++;
            const current = countMap.get(judgeId) || 0;
            if (current < n) {
              pairs.push({ judge_id: judgeId, team_id: teamId });
              countMap.set(judgeId, current + 1);
              placed = true;
              break;
            }
          }
          if (!placed) break;
        }

        const assigned = await insertAssignmentsBatch(pool, pairs);
        const skipped = unassignedRes.rows.length - pairs.length;
        return json(200, {
          assigned,
          per_judge: n,
          teams_remaining: skipped,
        });
      }

      if (parts[1] === "export" && parts[2] === "feedback" && method === "GET") {
        const scoreCols = SCORE_COLUMNS.map((c) => `s.${c}`).join(", ");
        const feedbackCols = FEEDBACK_COLUMNS.map((c) => `s.${c}`).join(", ");
        const scoresRes = await pool.query(`
          SELECT t.id AS team_id, t.name AS team_name, t.late_penalty,
            j.display_name AS judge_name, s.team_feedback,
            ${scoreCols}, ${feedbackCols}
          FROM teams t
          INNER JOIN scores s ON s.team_id = t.id AND s.is_submitted
          INNER JOIN judges j ON j.id = s.judge_id
          ORDER BY t.name, j.display_name
        `);

        if (!scoresRes.rows.length) {
          return json(400, { error: "No submitted marks to export yet." });
        }

        const teams = buildFeedbackExportData(scoresRes.rows);
        const pdf = await buildAllFeedbackPdf(teams);
        const data = Buffer.from(pdf).toString("base64");
        return json(200, { filename: "all-team-feedback.pdf", data });
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
