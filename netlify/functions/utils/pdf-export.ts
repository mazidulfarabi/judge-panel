import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { CRITERIA, adjustedTotal, totalFromRow } from "./criteria";

type ScoreRow = Record<string, string | number | boolean>;

export async function buildTeamScorecardPdf(
  teamName: string,
  latePenalty: number,
  judgeScores: { judgeName: string; row: ScoreRow }[]
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595, 842]);
  let y = 800;
  const draw = (text: string, size = 11, f = font) => {
    page.drawText(text.slice(0, 90), { x: 40, y, size, font: f, color: rgb(0.1, 0.1, 0.15) });
    y -= size + 6;
  };

  draw(`Scorecard: ${teamName}`, 16, bold);
  if (latePenalty > 0) {
    draw(`Late submission penalty: -${latePenalty} points`, 11, bold);
  }
  y -= 8;

  for (const { judgeName, row } of judgeScores) {
    if (y < 120) {
      page = doc.addPage([595, 842]);
      y = 800;
    }
    draw(`Judge: ${judgeName}`, 12, bold);
    const raw = totalFromRow(row as Record<string, number>);
    const final = adjustedTotal(raw, latePenalty);
    if (latePenalty > 0) {
      draw(`Raw total: ${raw} / 100 · Final (after penalty): ${final} / 100`);
    } else {
      draw(`Total: ${raw} / 100`);
    }
    for (const c of CRITERIA) {
      const score = row[c.key] ?? 0;
      const fb = String(row[`feedback_${c.key}`] || "").trim();
      draw(`${c.label}: ${score}/${c.max}${fb ? ` — ${fb.slice(0, 60)}` : ""}`, 9);
    }
    const tf = String(row.team_feedback || "").trim();
    if (tf) draw(`Team feedback: ${tf.slice(0, 200)}`, 9);
    y -= 10;
  }

  return doc.save();
}
