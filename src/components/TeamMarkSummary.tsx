import { CRITERIA } from "../criteria";

type TeamMarks = {
  team_feedback?: string | null;
  [key: string]: string | number | boolean | null | undefined;
};

type Props = {
  team: TeamMarks;
};

export default function TeamMarkSummary({ team }: Props) {
  const teamFb = String(team.team_feedback || "").trim();

  return (
    <div className="team-mark-summary">
      <div className="team-mark-criteria">
        {CRITERIA.map((c) => {
          const score = Number(team[c.key]) || 0;
          const fb = String(team[`feedback_${c.key}`] || "").trim();
          return (
            <div key={c.key} className="team-mark-row">
              <div className="team-mark-row-head">
                <span>{c.label}</span>
                <span className="team-mark-score">
                  {score}/{c.max}
                </span>
              </div>
              {fb ? <p className="team-mark-fb">{fb}</p> : null}
            </div>
          );
        })}
      </div>
      {teamFb ? (
        <div className="team-mark-overall">
          <div className="team-mark-overall-label">Overall team feedback</div>
          <p className="team-mark-fb">{teamFb}</p>
        </div>
      ) : null}
    </div>
  );
}
