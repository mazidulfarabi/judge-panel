/** Keep in sync with scripts/schema.sql */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  case_link TEXT NOT NULL,
  instructions TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username STRING NOT NULL UNIQUE,
  password_hash STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS judges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username STRING NOT NULL UNIQUE,
  password_hash STRING NOT NULL,
  display_name STRING NOT NULL,
  title STRING NOT NULL DEFAULT '',
  is_active BOOL NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name STRING NOT NULL UNIQUE,
  pdf_drive_link STRING NOT NULL,
  late_penalty INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id UUID NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (judge_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_assignments_judge ON assignments(judge_id);
CREATE INDEX IF NOT EXISTS idx_assignments_team ON assignments(team_id);

CREATE TABLE IF NOT EXISTS scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id UUID NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  situation_analysis INT NOT NULL DEFAULT 0,
  problem_analysis INT NOT NULL DEFAULT 0,
  target_group_analysis INT NOT NULL DEFAULT 0,
  branding_justification INT NOT NULL DEFAULT 0,
  big_idea INT NOT NULL DEFAULT 0,
  marketing_strategy INT NOT NULL DEFAULT 0,
  feasibility INT NOT NULL DEFAULT 0,
  financials_timeline INT NOT NULL DEFAULT 0,
  monitoring_evaluation INT NOT NULL DEFAULT 0,
  idea_creativity INT NOT NULL DEFAULT 0,
  feedback_situation_analysis STRING NOT NULL DEFAULT '',
  feedback_problem_analysis STRING NOT NULL DEFAULT '',
  feedback_target_group_analysis STRING NOT NULL DEFAULT '',
  feedback_branding_justification STRING NOT NULL DEFAULT '',
  feedback_big_idea STRING NOT NULL DEFAULT '',
  feedback_marketing_strategy STRING NOT NULL DEFAULT '',
  feedback_feasibility STRING NOT NULL DEFAULT '',
  feedback_financials_timeline STRING NOT NULL DEFAULT '',
  feedback_monitoring_evaluation STRING NOT NULL DEFAULT '',
  feedback_idea_creativity STRING NOT NULL DEFAULT '',
  team_feedback STRING NOT NULL DEFAULT '',
  is_submitted BOOL NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (judge_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_scores_team ON scores(team_id);
CREATE INDEX IF NOT EXISTS idx_scores_judge ON scores(judge_id);
`;
