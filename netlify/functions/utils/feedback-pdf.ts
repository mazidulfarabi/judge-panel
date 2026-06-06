import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib";
import { BRAND } from "../../../shared/criteria";
import { CRITERIA } from "./criteria";

export type JudgeFeedback = {
  judgeName: string;
  teamFeedback: string;
  criterionFeedback: { label: string; text: string }[];
};

export type TeamFeedback = {
  teamName: string;
  judges: JudgeFeedback[];
};

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

type Drawer = {
  page: PDFPage;
  y: number;
  ensure: (needed: number) => void;
  draw: (text: string, size: number, f: PDFFont, indent?: number) => void;
  gap: (n: number) => void;
};

function makeDrawer(doc: PDFDocument, font: PDFFont, margin: number, maxWidth: number): Drawer {
  let page = doc.addPage([595, 842]);
  let y = 800;

  const ensure = (needed: number) => {
    if (y - needed < 56) {
      page = doc.addPage([595, 842]);
      y = 800;
    }
  };

  const draw = (text: string, size: number, f: PDFFont, indent = 0) => {
    const lines = wrapText(text, f, size, maxWidth - indent);
    for (const line of lines) {
      ensure(size + 8);
      page.drawText(line || " ", {
        x: margin + indent,
        y,
        size,
        font: f,
        color: rgb(0.1, 0.1, 0.15),
      });
      y -= size + 5;
    }
  };

  const gap = (n: number) => {
    y -= n;
  };

  return {
    get page() {
      return page;
    },
    get y() {
      return y;
    },
    ensure,
    draw,
    gap,
  };
}

export async function buildAllFeedbackPdf(teams: TeamFeedback[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  const maxWidth = 595 - margin * 2;
  const d = makeDrawer(doc, font, margin, maxWidth);

  d.draw(`${BRAND.event} — Team Feedback`, 18, bold);
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
    font
  );
  d.gap(16);

  for (let ti = 0; ti < teams.length; ti++) {
    const team = teams[ti];
    if (ti > 0) d.gap(12);
    d.draw(team.teamName, 15, bold);
    d.gap(6);

    for (const judge of team.judges) {
      const hasCriterion = judge.criterionFeedback.length > 0;
      const hasTeam = Boolean(judge.teamFeedback.trim());
      if (!hasTeam && !hasCriterion) continue;

      d.draw(`Judge: ${judge.judgeName}`, 12, bold);
      d.gap(4);

      if (hasTeam) {
        d.draw("Overall team feedback", 10, bold);
        d.gap(2);
        d.draw(judge.teamFeedback, 10, font, 8);
        d.gap(6);
      }

      for (const c of judge.criterionFeedback) {
        d.draw(c.label, 10, bold);
        d.gap(2);
        d.draw(c.text, 10, font, 8);
        d.gap(4);
      }
      d.gap(6);
    }
  }

  return doc.save();
}

export function teamFeedbackFromRows(
  rows: Record<string, unknown>[]
): TeamFeedback[] {
  const byTeam = new Map<string, TeamFeedback>();

  for (const row of rows) {
    const teamName = String(row.team_name || "");
    let team = byTeam.get(teamName);
    if (!team) {
      team = { teamName, judges: [] };
      byTeam.set(teamName, team);
    }

    const criterionFeedback = CRITERIA.map((c) => ({
      label: c.label,
      text: String(row[`feedback_${c.key}`] || "").trim(),
    })).filter((c) => c.text);

    team.judges.push({
      judgeName: String(row.judge_name || "Judge"),
      teamFeedback: String(row.team_feedback || "").trim(),
      criterionFeedback,
    });
  }

  return [...byTeam.values()].sort((a, b) => a.teamName.localeCompare(b.teamName));
}
