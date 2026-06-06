import { PDFDocument, PDFFont, RGB, rgb, StandardFonts } from "pdf-lib";
import { BRAND, TOTAL_MAX } from "../../../shared/criteria";
import { adjustedTotal, CRITERIA, totalFromRow } from "./criteria";

export type JudgeFeedback = {
  judgeName: string;
  totalScore: number;
  teamFeedback: string;
  criteria: { label: string; score: number; max: number; feedback: string }[];
};

export type CriterionSummary = {
  label: string;
  max: number;
  avgScore: number;
  rank: number;
};

export type TeamExport = {
  teamName: string;
  rank: number;
  totalScore: number;
  criteria: CriterionSummary[];
  judges: JudgeFeedback[];
};

const COLOR_TEXT = rgb(0.1, 0.1, 0.15);
const COLOR_MUTED = rgb(0.35, 0.4, 0.48);
const COLOR_RED = rgb(0.77, 0.12, 0.23);

const EMPTY_FEEDBACK = /^(n\/?a|na|nil|none|null|no\s*feedback|not\s*applicable)$/i;
const PUNCT_ONLY = /^[-–—./\\|_*,;:!?'"`~]+$/;
const SUPERLATIVE =
  /\b(best|greatest|excellent|amazing|perfect|outstanding|superb|brilliant|fantastic|wonderful|awesome|incredible|remarkable|exceptional|top[- ]?notch|well\s+done|good\s+(job|work|solution|idea|effort)|nice\s+(work|job|solution|idea)|great\s+(job|work|solution|idea)|best\s+solution|winner|#1)\b/i;

/** Standard PDF fonts only support WinAnsi; strip characters that would crash export. */
function toWinAnsi(text: string): string {
  return [...text]
    .map((ch) => {
      const cp = ch.codePointAt(0)!;
      if (cp === 9 || cp === 10 || cp === 13) return ch;
      if (cp >= 0x20 && cp <= 0x7e) return ch;
      if (cp >= 0xa0 && cp <= 0xff) return ch;
      return "?";
    })
    .join("");
}

export function isLowQualityFeedback(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (PUNCT_ONLY.test(t)) return true;
  if (EMPTY_FEEDBACK.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return true;
  if (SUPERLATIVE.test(t)) return true;
  return false;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const normalized = toWinAnsi(text).replace(/\r\n/g, "\n");
  const paragraphs = normalized.split("\n");
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }
    const words = para.split(/\s+/);
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function assignRanks<T>(items: T[], scoreOf: (item: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => scoreOf(b) - scoreOf(a));
  const ranks = new Map<T, number>();
  let rank = 0;
  let prev: number | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const score = scoreOf(sorted[i]);
    if (prev === null || score < prev - 1e-9) {
      rank = i + 1;
      prev = score;
    }
    ranks.set(sorted[i], rank);
  }
  return ranks;
}

function feedbackDisplay(text: string): string {
  const t = text.trim();
  return t || "(no feedback)";
}

type Drawer = {
  ensure: (needed: number) => void;
  draw: (text: string, size: number, f: PDFFont, opts?: { indent?: number; color?: RGB }) => void;
  gap: (n: number) => void;
};

function makeDrawer(doc: PDFDocument, margin: number, maxWidth: number): Drawer {
  let page = doc.addPage([595, 842]);
  let y = 800;

  const ensure = (needed: number) => {
    if (y - needed < 56) {
      page = doc.addPage([595, 842]);
      y = 800;
    }
  };

  const draw = (
    text: string,
    size: number,
    f: PDFFont,
    opts: { indent?: number; color?: RGB } = {}
  ) => {
    const indent = opts.indent ?? 0;
    const color = opts.color ?? COLOR_TEXT;
    const lines = wrapText(text, f, size, maxWidth - indent);
    for (const line of lines) {
      ensure(size + 8);
      page.drawText(line || " ", {
        x: margin + indent,
        y,
        size,
        font: f,
        color,
      });
      y -= size + 5;
    }
  };

  const gap = (n: number) => {
    y -= n;
  };

  return { ensure, draw, gap };
}

export async function buildAllFeedbackPdf(teams: TeamExport[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  const maxWidth = 595 - margin * 2;
  const d = makeDrawer(doc, margin, maxWidth);

  d.draw(`${BRAND.event} — Marks & Feedback Report`, 18, bold);
  d.gap(4);
  d.draw(BRAND.org, 11, font);
  d.gap(8);
  d.draw(
    `Generated ${new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })}`,
    10,
    font,
    { color: COLOR_MUTED }
  );
  d.gap(16);

  const sorted = [...teams].sort((a, b) => a.rank - b.rank || a.teamName.localeCompare(b.teamName));

  for (let ti = 0; ti < sorted.length; ti++) {
    const team = sorted[ti];
    if (ti > 0) d.gap(14);

    d.draw(
      `${team.teamName}  ·  Rank #${team.rank}  ·  Total ${team.totalScore.toFixed(1)}/${TOTAL_MAX}`,
      14,
      bold
    );
    d.gap(8);

    d.draw("Criteria scores (team average)", 11, bold);
    d.gap(4);
    for (const c of team.criteria) {
      d.draw(
        `${c.label}: ${c.avgScore.toFixed(1)}/${c.max}  (Rank #${c.rank})`,
        10,
        font
      );
    }
    d.gap(10);

    for (const judge of team.judges) {
      d.draw(`Judge: ${judge.judgeName}  ·  Total ${judge.totalScore}/${TOTAL_MAX}`, 11, bold);
      d.gap(4);

      d.draw("Overall team feedback", 10, bold);
      d.gap(2);
      const teamFb = feedbackDisplay(judge.teamFeedback);
      d.draw(teamFb, 10, font, {
        indent: 8,
        color: isLowQualityFeedback(judge.teamFeedback) ? COLOR_RED : COLOR_TEXT,
      });
      d.gap(6);

      for (const c of judge.criteria) {
        d.draw(`${c.label} — ${c.score}/${c.max}`, 10, bold);
        d.gap(2);
        const fb = feedbackDisplay(c.feedback);
        d.draw(fb, 10, font, {
          indent: 8,
          color: isLowQualityFeedback(c.feedback) ? COLOR_RED : COLOR_TEXT,
        });
        d.gap(4);
      }
      d.gap(8);
    }
  }

  return doc.save();
}

type TeamBucket = {
  teamId: string;
  teamName: string;
  latePenalty: number;
  judgeRows: Record<string, unknown>[];
};

export function buildFeedbackExportData(rows: Record<string, unknown>[]): TeamExport[] {
  const buckets = new Map<string, TeamBucket>();

  for (const row of rows) {
    const teamId = String(row.team_id || "");
    let bucket = buckets.get(teamId);
    if (!bucket) {
      bucket = {
        teamId,
        teamName: String(row.team_name || ""),
        latePenalty: Number(row.late_penalty) || 0,
        judgeRows: [],
      };
      buckets.set(teamId, bucket);
    }
    bucket.judgeRows.push(row);
  }

  const teamList = [...buckets.values()];

  const totalRanks = assignRanks(teamList, (t) => {
    const finals = t.judgeRows.map((r) =>
      adjustedTotal(totalFromRow(r as Record<string, number>), t.latePenalty)
    );
    return finals.reduce((a, b) => a + b, 0) / finals.length;
  });

  const criterionRanks = new Map<string, Map<TeamBucket, number>>();
  for (const c of CRITERIA) {
    criterionRanks.set(
      c.key,
      assignRanks(teamList, (t) => {
        const scores = t.judgeRows.map((r) => Number(r[c.key]) || 0);
        return scores.reduce((a, b) => a + b, 0) / scores.length;
      })
    );
  }

  return teamList.map((t) => {
    const finals = t.judgeRows.map((r) =>
      adjustedTotal(totalFromRow(r as Record<string, number>), t.latePenalty)
    );
    const totalScore = finals.reduce((a, b) => a + b, 0) / finals.length;

    const criteria: CriterionSummary[] = CRITERIA.map((c) => {
      const scores = t.judgeRows.map((r) => Number(r[c.key]) || 0);
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      return {
        label: c.label,
        max: c.max,
        avgScore,
        rank: criterionRanks.get(c.key)!.get(t)!,
      };
    });

    const judges: JudgeFeedback[] = t.judgeRows.map((r) => ({
      judgeName: String(r.judge_name || "Judge"),
      totalScore: adjustedTotal(totalFromRow(r as Record<string, number>), t.latePenalty),
      teamFeedback: String(r.team_feedback || ""),
      criteria: CRITERIA.map((c) => ({
        label: c.label,
        score: Number(r[c.key]) || 0,
        max: c.max,
        feedback: String(r[`feedback_${c.key}`] || ""),
      })),
    }));

    return {
      teamName: t.teamName,
      rank: totalRanks.get(t)!,
      totalScore,
      criteria,
      judges,
    };
  });
}
