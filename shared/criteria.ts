export const CASE_LINK =
  "https://drive.google.com/file/d/119MYxnOduI2LWv5N4gAowNnpPSr6xnjy/view?usp=sharing";

export const MARKING_INSTRUCTIONS = `Please do accurate marking. Try to avoid leniency, strictness, or central tendency (all teams getting similar marks). Score each criterion independently based on the rubric.`;

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

export function drivePreviewUrl(link: string): string {
  const m = link.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  return link;
}
