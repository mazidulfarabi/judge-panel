export const BRAND = {
  event: "Breaking Brand 2026",
  org: "IBA-JU Business Club",
  portal: "Judges Portal for R1",
  full: "Breaking Brand 2026 by IBA-JU Business Club",
  subtitle: "Judges Portal for R1",
} as const;

export const DEADLINE = "2nd June 2026";

export const CASE_LINK =
  "https://drive.google.com/file/d/119MYxnOduI2LWv5N4gAowNnpPSr6xnjy/view?usp=sharing";

export const CRITERIA = [
  { key: "situation_analysis", label: "Situation Analysis", max: 10 },
  { key: "problem_analysis", label: "Problem Analysis", max: 10 },
  { key: "target_group_analysis", label: "Target Group Analysis", max: 5 },
  { key: "branding_justification", label: "Branding Justification", max: 10 },
  { key: "big_idea", label: "Big Idea", max: 15 },
  { key: "marketing_strategy", label: "Marketing Strategy", max: 15 },
  { key: "feasibility", label: "Feasibility", max: 10 },
  { key: "financials_timeline", label: "Financials & Timeline", max: 5 },
  { key: "monitoring_evaluation", label: "Monitoring & Evaluation", max: 5 },
  { key: "idea_creativity", label: "Idea Creativity", max: 15 },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]["key"];

export const TOTAL_MAX = CRITERIA.reduce((s, c) => s + c.max, 0);

export function buildDefaultInstructions(): string {
  const criteriaList = CRITERIA.map((c) => `• ${c.label} — ${c.max} pts`).join("\n");
  return `Please complete all your assigned teams by ${DEADLINE}.

Marking criteria (${TOTAL_MAX} points total):
${criteriaList}

Please mark accurately. Avoid leniency, strictness, or central tendency (similar marks for every team). Score each criterion independently.`;
}

export const MARKING_INSTRUCTIONS = buildDefaultInstructions();

/** Extract Google Drive file ID from common link formats. */
export function extractDriveFileId(link: string): string | null {
  if (!link?.trim()) return null;
  if (/\/folders\//i.test(link)) return null;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /\/presentation\/d\/([a-zA-Z0-9_-]+)/,
    /\/document\/d\/([a-zA-Z0-9_-]+)/,
    /\/open\?[^#]*\bid=([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
  ];
  for (const p of patterns) {
    const m = link.match(p);
    if (m) return m[1];
  }
  return null;
}

export function driveEmbedUrl(link: string): string {
  const id = extractDriveFileId(link);
  if (!id) return link;
  if (/\/presentation\//i.test(link)) {
    return `https://docs.google.com/presentation/d/${id}/embed?start=false&loop=false`;
  }
  return `https://drive.google.com/file/d/${id}/preview`;
}

export function drivePreviewUrl(link: string): string {
  return driveEmbedUrl(link);
}
