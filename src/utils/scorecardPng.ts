import { BRAND, CRITERIA, TOTAL_MAX } from "../criteria";

export type JudgeScore = Record<string, string | number>;

export type ScorecardData = {
  team_name: string;
  late_penalty: number;
  avg_total: number | null;
  judges_scored: number;
  judges: { judge_name: string; scores: JudgeScore }[];
};

type Aggregated = {
  totalScore: number;
  criteria: { key: string; label: string; max: number; score: number; feedback: string }[];
  teamFeedback: string;
};

const W = 640;
const PAD = 40;
const CONTENT_W = W - PAD * 2;

const COLORS = {
  bg: "#ffffff",
  navy: "#1a365d",
  text: "#1e293b",
  muted: "#64748b",
  light: "#94a3b8",
  rowBg: "#f1f5f9",
  pillBg: "#e2e8f0",
  divider: "#e2e8f0",
  feedbackBg: "#f8fafc",
};

type Ctx = CanvasRenderingContext2D;

function font(weight: number, size: number) {
  return `${weight} ${size}px "DM Sans", system-ui, sans-serif`;
}

function wrapLines(ctx: Ctx, text: string, maxW: number): string[] {
  if (!text.trim()) return [];
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function mergeFeedback(values: string[]): string {
  const unique: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (t && !unique.includes(t)) unique.push(t);
  }
  return unique.join("\n\n");
}

function aggregate(data: ScorecardData): Aggregated {
  const n = data.judges.length;
  const criteria = CRITERIA.map((c) => {
    const avg = data.judges.reduce((s, j) => s + (Number(j.scores[c.key]) || 0), 0) / n;
    const feedback = mergeFeedback(
      data.judges.map((j) => String(j.scores[`feedback_${c.key}`] || ""))
    );
    return {
      key: c.key,
      label: c.label,
      max: c.max,
      score: Math.round(avg),
      feedback,
    };
  });

  const teamFeedback = mergeFeedback(
    data.judges.map((j) => String(j.scores.team_feedback || ""))
  );

  const totalScore =
    data.avg_total != null
      ? Math.round(data.avg_total)
      : criteria.reduce((s, c) => s + c.score, 0);

  return { totalScore, criteria, teamFeedback };
}

function drawBarIcon(ctx: Ctx, x: number, y: number) {
  ctx.fillStyle = COLORS.navy;
  const bars = [
    { h: 10, w: 3 },
    { h: 14, w: 3 },
    { h: 8, w: 3 },
  ];
  let bx = x;
  for (const b of bars) {
    roundRect(ctx, bx, y - b.h, b.w, b.h, 1);
    ctx.fill();
    bx += 5;
  }
}

function criterionRowHeight(ctx: Ctx, c: Aggregated["criteria"][0]): number {
  let h = 44;
  if (c.feedback) {
    ctx.font = font(400, 11);
    h += wrapLines(ctx, c.feedback, CONTENT_W - 32).length * 16 + 14;
  }
  return h;
}

function measureHeight(data: ScorecardData, agg: Aggregated, ctx: Ctx): number {
  const latePenalty = Number(data.late_penalty) || 0;
  let y = PAD;

  y += 40; // team name
  y += 22; // subtitle
  y += 24; // divider
  y += 108; // total box
  if (latePenalty > 0) y += 28;
  y += 28; // section gap
  y += 28; // section title
  y += 8;

  ctx.font = font(400, 11);
  for (const c of agg.criteria) {
    y += criterionRowHeight(ctx, c) + 8;
  }

  if (agg.teamFeedback) {
    y += 20;
    y += 28;
    ctx.font = font(400, 12);
    y += wrapLines(ctx, agg.teamFeedback, CONTENT_W - 32).length * 18 + 20;
  }

  y += 32; // footer divider
  y += 20; // footer line 1
  y += 16; // footer line 2
  return y + PAD;
}

function drawCriterionRow(ctx: Ctx, c: Aggregated["criteria"][0], y: number): number {
  const rowH = 44;
  roundRect(ctx, PAD, y, CONTENT_W, rowH, 8);
  ctx.fillStyle = COLORS.rowBg;
  ctx.fill();

  ctx.fillStyle = COLORS.text;
  ctx.font = font(500, 13);
  ctx.textAlign = "left";
  ctx.fillText(c.label, PAD + 16, y + 27);

  const scoreText = `${c.score}/${c.max}`;
  ctx.font = font(600, 12);
  const pillW = ctx.measureText(scoreText).width + 20;
  const pillX = PAD + CONTENT_W - pillW - 12;
  roundRect(ctx, pillX, y + 10, pillW, 24, 6);
  ctx.fillStyle = COLORS.pillBg;
  ctx.fill();
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = "center";
  ctx.fillText(scoreText, pillX + pillW / 2, y + 27);
  ctx.textAlign = "left";

  let bottom = y + rowH;
  if (c.feedback) {
    bottom += 6;
    ctx.font = font(400, 11);
    const lines = wrapLines(ctx, c.feedback, CONTENT_W - 32);
    const fbH = lines.length * 16 + 16;
    roundRect(ctx, PAD + 8, bottom, CONTENT_W - 16, fbH, 6);
    ctx.fillStyle = COLORS.feedbackBg;
    ctx.fill();
    ctx.fillStyle = COLORS.muted;
    let fy = bottom + 14;
    for (const line of lines) {
      ctx.fillText(line, PAD + 16, fy);
      fy += 16;
    }
    bottom += fbH;
  }
  return bottom + 8;
}

function drawScorecard(ctx: Ctx, data: ScorecardData, agg: Aggregated) {
  const latePenalty = Number(data.late_penalty) || 0;
  let y = PAD;

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.navy;
  ctx.font = font(700, 30);
  ctx.fillText(data.team_name, W / 2, y + 8);
  y += 36;

  ctx.fillStyle = COLORS.muted;
  ctx.font = font(400, 14);
  ctx.fillText("Evaluation Score Card", W / 2, y);
  y += 22;

  ctx.strokeStyle = COLORS.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(PAD + CONTENT_W, y);
  ctx.stroke();
  y += 24;

  const boxH = 96;
  roundRect(ctx, PAD, y, CONTENT_W, boxH, 12);
  ctx.fillStyle = COLORS.navy;
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = font(600, 11);
  ctx.fillText("TOTAL SCORE", W / 2, y + 30);

  ctx.fillStyle = "#ffffff";
  ctx.font = font(700, 42);
  ctx.fillText(`${agg.totalScore}/${TOTAL_MAX}`, W / 2, y + 72);
  y += boxH + 16;

  if (latePenalty > 0) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = font(500, 12);
    ctx.fillText(
      `Late submission penalty: −${latePenalty} points (time exceeded to submit)`,
      W / 2,
      y
    );
    y += 24;
  }

  y += 8;
  ctx.textAlign = "left";
  drawBarIcon(ctx, PAD, y - 2);
  ctx.fillStyle = COLORS.text;
  ctx.font = font(600, 14);
  ctx.fillText("Score Breakdown by Criteria", PAD + 22, y);
  y += 28;

  for (const c of agg.criteria) {
    y = drawCriterionRow(ctx, c, y);
  }

  if (agg.teamFeedback) {
    y += 8;
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.navy;
    ctx.font = font(600, 14);
    ctx.fillText("Overall Team Feedback", PAD, y);
    y += 20;

    ctx.font = font(400, 12);
    const lines = wrapLines(ctx, agg.teamFeedback, CONTENT_W - 32);
    const boxH2 = lines.length * 18 + 24;
    roundRect(ctx, PAD, y, CONTENT_W, boxH2, 8);
    ctx.fillStyle = COLORS.feedbackBg;
    ctx.fill();
    ctx.strokeStyle = COLORS.divider;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = COLORS.text;
    let fy = y + 20;
    for (const line of lines) {
      ctx.fillText(line, PAD + 16, fy);
      fy += 18;
    }
    y += boxH2;
  }

  y += 24;
  ctx.strokeStyle = COLORS.divider;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(PAD + CONTENT_W, y);
  ctx.stroke();
  y += 20;

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.light;
  ctx.font = font(400, 11);
  ctx.fillText(`Generated from ${BRAND.event} Judges Evaluation Portal`, W / 2, y);
  y += 16;
  ctx.fillText(BRAND.org, W / 2, y);
  ctx.textAlign = "left";
}

function safeFilename(name: string): string {
  const safe = name.replace(/[^\w\s-]/g, "").trim().slice(0, 80);
  return safe || "team";
}

export async function downloadScorecardPng(data: ScorecardData): Promise<void> {
  await Promise.all([
    document.fonts.load('400 12px "DM Sans"'),
    document.fonts.load('700 30px "DM Sans"'),
    document.fonts.load('700 42px "DM Sans"'),
  ]);

  const agg = aggregate(data);
  const scale = 2;
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d")!;
  const height = measureHeight(data, agg, measureCtx);

  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, height);

  drawScorecard(ctx, data, agg);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create image"))), "image/png");
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFilename(data.team_name)}-marksheet.png`;
  a.click();
  URL.revokeObjectURL(url);
}
