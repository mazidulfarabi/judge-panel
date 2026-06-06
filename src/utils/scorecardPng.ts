import { BRAND, CRITERIA, TOTAL_MAX, adjustedTotal, rawTotalFromScores } from "../criteria";

export type JudgeScore = Record<string, string | number>;

export type ScorecardData = {
  team_name: string;
  late_penalty: number;
  avg_total: number | null;
  judges_scored: number;
  judges: { judge_name: string; scores: JudgeScore }[];
};

const W = 820;
const PAD = 44;
const CONTENT_W = W - PAD * 2;

const COLORS = {
  bg: "#ffffff",
  accent: "#1d5bbf",
  accentLight: "#e8f0fe",
  text: "#0f172a",
  muted: "#5b6b82",
  border: "#d4e0f0",
  surface: "#f4f7fc",
  success: "#0d7a4e",
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

function measureHeight(data: ScorecardData, ctx: Ctx): number {
  const latePenalty = Number(data.late_penalty) || 0;
  let y = PAD;

  y += 88; // header
  y += 24;
  y += 36; // team name
  y += 22; // subtitle
  y += 20;
  const summaryH = latePenalty > 0 ? 64 : 48;
  y += summaryH + 20;

  const labelW = 200;
  const scoreW = 72;
  const fbW = CONTENT_W - labelW - scoreW - 16;
  ctx.font = font(400, 11);

  for (const judge of data.judges) {
    y += 40; // judge header
    y += 28; // table header
    for (const c of CRITERIA) {
      const fb = String(judge.scores[`feedback_${c.key}`] || "").trim();
      const lines = fb ? wrapLines(ctx, fb, fbW) : ["—"];
      y += Math.max(28, lines.length * 18 + 10);
    }
    y += 36; // totals
    const tf = String(judge.scores.team_feedback || "").trim();
    if (tf) {
      y += 22;
      y += wrapLines(ctx, tf, CONTENT_W - 24).length * 18 + 12;
    }
    y += 24; // section gap
  }

  y += 36; // footer
  return y + PAD;
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

function drawScorecard(ctx: Ctx, data: ScorecardData) {
  const latePenalty = Number(data.late_penalty) || 0;
  let y = PAD;

  // Header bar
  roundRect(ctx, PAD, y, CONTENT_W, 72, 10);
  ctx.fillStyle = COLORS.accent;
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = font(700, 22);
  ctx.fillText(BRAND.event, PAD + 20, y + 32);
  ctx.font = font(500, 13);
  ctx.fillText(`${BRAND.org} · ${BRAND.portal}`, PAD + 20, y + 54);
  y += 88;

  y += 16;
  ctx.fillStyle = COLORS.muted;
  ctx.font = font(600, 11);
  ctx.fillText("MARKSHEET & FEEDBACK", PAD, y);
  y += 20;

  ctx.fillStyle = COLORS.text;
  ctx.font = font(700, 28);
  ctx.fillText(data.team_name, PAD, y + 8);
  y += 36;

  ctx.fillStyle = COLORS.muted;
  ctx.font = font(400, 13);
  const dateStr = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  ctx.fillText(`Generated ${dateStr}`, PAD, y);
  y += 24;

  // Summary box
  const summaryH = latePenalty > 0 ? 64 : 48;
  roundRect(ctx, PAD, y, CONTENT_W, summaryH, 8);
  ctx.fillStyle = COLORS.surface;
  ctx.fill();
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = COLORS.text;
  ctx.font = font(600, 14);
  const avgText =
    data.avg_total != null
      ? `Average score: ${data.avg_total.toFixed(1)} / ${TOTAL_MAX}`
      : "Average score: —";
  ctx.fillText(avgText, PAD + 16, y + 28);

  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.muted;
  ctx.font = font(500, 13);
  ctx.fillText(
    `${data.judges_scored} judge${data.judges_scored === 1 ? "" : "s"}`,
    PAD + CONTENT_W - 16,
    y + 28
  );
  ctx.textAlign = "left";

  if (latePenalty > 0) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = font(500, 12);
    ctx.fillText(`Late submission penalty: −${latePenalty} pts per judge`, PAD + 16, y + 50);
  }
  y += summaryH + 20;

  const labelW = 200;
  const scoreW = 72;
  const fbX = PAD + labelW + scoreW + 12;
  const fbW = CONTENT_W - labelW - scoreW - 16;

  for (let ji = 0; ji < data.judges.length; ji++) {
    const judge = data.judges[ji];
    const scores = judge.scores;
    const raw = rawTotalFromScores(scores);
    const final = adjustedTotal(raw, latePenalty);

    ctx.fillStyle = COLORS.accent;
    ctx.font = font(700, 15);
    ctx.fillText(`Judge: ${judge.judge_name}`, PAD, y);
    y += 28;

    // Table header
    roundRect(ctx, PAD, y, CONTENT_W, 26, 6);
    ctx.fillStyle = COLORS.accentLight;
    ctx.fill();
    ctx.fillStyle = COLORS.accent;
    ctx.font = font(600, 11);
    ctx.fillText("CRITERION", PAD + 12, y + 17);
    ctx.fillText("SCORE", PAD + labelW + 8, y + 17);
    ctx.fillText("FEEDBACK", fbX, y + 17);
    y += 30;

    for (const c of CRITERIA) {
      const score = Number(scores[c.key]) || 0;
      const fb = String(scores[`feedback_${c.key}`] || "").trim();
      const fbLines = fb ? wrapLines(ctx, fb, fbW) : ["—"];
      const rowH = Math.max(28, fbLines.length * 18 + 10);

      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, y + rowH);
      ctx.lineTo(PAD + CONTENT_W, y + rowH);
      ctx.stroke();

      ctx.fillStyle = COLORS.text;
      ctx.font = font(500, 12);
      ctx.fillText(c.label, PAD + 12, y + 18);

      ctx.font = font(700, 12);
      ctx.fillStyle = COLORS.accent;
      ctx.fillText(`${score}/${c.max}`, PAD + labelW + 8, y + 18);

      ctx.font = font(400, 11);
      ctx.fillStyle = fb ? COLORS.text : COLORS.muted;
      let fy = y + 16;
      for (const line of fbLines) {
        ctx.fillText(line, fbX, fy);
        fy += 18;
      }
      y += rowH;
    }

    y += 8;
    ctx.font = font(700, 13);
    ctx.fillStyle = COLORS.text;
    if (latePenalty > 0) {
      ctx.fillText(`Raw total: ${raw}/${TOTAL_MAX}  ·  Final: ${final}/${TOTAL_MAX}`, PAD, y);
    } else {
      ctx.fillText(`Total: ${raw}/${TOTAL_MAX}`, PAD, y);
    }
    y += 24;

    const tf = String(scores.team_feedback || "").trim();
    if (tf) {
      ctx.font = font(400, 12);
      const tfLines = wrapLines(ctx, tf, CONTENT_W - 24);
      const boxH = tfLines.length * 18 + 36;
      roundRect(ctx, PAD, y, CONTENT_W, boxH, 6);
      ctx.fill();
      ctx.strokeStyle = COLORS.border;
      ctx.stroke();

      ctx.fillStyle = COLORS.accent;
      ctx.font = font(600, 11);
      ctx.fillText("OVERALL TEAM FEEDBACK", PAD + 12, y + 18);
      ctx.fillStyle = COLORS.text;
      ctx.font = font(400, 12);
      let ty = y + 36;
      for (const line of tfLines) {
        ctx.fillText(line, PAD + 12, ty);
        ty += 18;
      }
      y += boxH + 8;
    }

    if (ji < data.judges.length - 1) {
      y += 8;
      ctx.strokeStyle = COLORS.border;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD + 40, y);
      ctx.lineTo(PAD + CONTENT_W - 40, y);
      ctx.stroke();
      ctx.setLineDash([]);
      y += 16;
    }
  }

  y += 12;
  ctx.strokeStyle = COLORS.border;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(PAD + CONTENT_W, y);
  ctx.stroke();
  y += 20;

  ctx.fillStyle = COLORS.muted;
  ctx.font = font(400, 11);
  ctx.textAlign = "center";
  ctx.fillText(BRAND.full, W / 2, y);
  ctx.textAlign = "left";
}

function safeFilename(name: string): string {
  const safe = name.replace(/[^\w\s-]/g, "").trim().slice(0, 80);
  return safe || "team";
}

export async function downloadScorecardPng(data: ScorecardData): Promise<void> {
  await Promise.all([
    document.fonts.load('400 12px "DM Sans"'),
    document.fonts.load('700 28px "DM Sans"'),
  ]);

  const scale = 2;
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d")!;
  measureCtx.font = font(400, 12);
  const height = measureHeight(data, measureCtx);

  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, height);

  drawScorecard(ctx, data);

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
