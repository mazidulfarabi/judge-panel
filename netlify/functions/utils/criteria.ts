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

export const SCORE_COLUMNS = CRITERIA.map((c) => c.key);
export const FEEDBACK_COLUMNS = CRITERIA.map((c) => `feedback_${c.key}`);

export function totalFromRow(row: Record<string, number>): number {
  return CRITERIA.reduce((s, c) => s + (Number(row[c.key]) || 0), 0);
}

export function validateScores(body: Record<string, unknown>): string | null {
  for (const c of CRITERIA) {
    const v = body[c.key];
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > c.max) {
      return `${c.label} must be an integer from 0 to ${c.max}`;
    }
  }
  return null;
}
