import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getSession } from "../api";
import AppShell from "../components/AppShell";
import DriveLink from "../components/DriveLink";
import LatePenaltyBadge from "../components/LatePenaltyBadge";
import LoadingSpinner from "../components/LoadingSpinner";
import { CRITERIA, DEADLINE } from "../criteria";

type Team = {
  id: string;
  name: string;
  pdf_drive_link: string;
  late_penalty: number;
  is_submitted: boolean;
  has_draft: boolean;
  raw_total: number;
  current_total: number;
};

type Dashboard = {
  display_name: string;
  title: string;
  assigned: number;
  completed: number;
  case_link: string;
  instructions: string;
};

export default function JudgeDashboard() {
  const session = getSession();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<Dashboard>("/judge/dashboard"),
      api<{ teams: Team[] }>("/judge/teams"),
    ])
      .then(([d, t]) => {
        setDash(d);
        setTeams(t.teams);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const pct = dash && dash.assigned > 0 ? Math.round((dash.completed / dash.assigned) * 100) : 0;
  const remaining = dash ? dash.assigned - dash.completed : 0;

  return (
    <AppShell
      title={`Hello, ${dash?.display_name || session.name}`}
      actions={
        <Link to="/leaderboard" className="btn btn-ghost btn-sm">
          Leaderboard
        </Link>
      }
    >
      {dash?.title && <p className="text-muted" style={{ marginTop: "-0.75rem" }}>{dash.title}</p>}

      {err && <div className="alert alert-error">{err}</div>}

      {loading && <LoadingSpinner />}

      {!loading && dash && (
        <>
          <div className="card">
            <h2>Your progress</h2>
            <p style={{ margin: "0 0 0.75rem", fontSize: "1.05rem" }}>
              <strong>{dash.completed}</strong> of <strong>{dash.assigned}</strong> teams submitted
              {remaining > 0 && (
                <span className="text-muted"> · {remaining} remaining</span>
              )}
            </p>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="alert alert-info">
            <p style={{ margin: "0 0 0.5rem" }}>
              <span className="deadline">Please complete all your assigned teams by {DEADLINE}.</span>
            </p>
            {dash.instructions ? (
              <p style={{ margin: 0 }}>{dash.instructions}</p>
            ) : null}
            <ul className="instructions-criteria">
              {CRITERIA.map((c) => (
                <li key={c.key}>
                  {c.label} — {c.max} pts
                </li>
              ))}
            </ul>
          </div>

          {dash.case_link && (
            <div className="card">
              <h2>Case brief</h2>
              <p className="text-muted" style={{ marginTop: 0, fontSize: "0.9rem" }}>
                Open the case document before marking teams.
              </p>
              <DriveLink href={dash.case_link} label="Open case slides in new tab" />
            </div>
          )}
        </>
      )}

      {!loading && (
      <div className="card">
        <h2>Assigned teams</h2>
        {!teams.length && !err ? (
          <p className="text-muted">No teams assigned yet. Contact the admin.</p>
        ) : (
          <div className="team-list">
            {teams.map((t) => (
              <div key={t.id} className="team-card">
                <div className="team-card-head">
                  <span className="team-card-name">
                    {t.name}
                    <LatePenaltyBadge penalty={t.late_penalty} style={{ marginLeft: "0.35rem" }} />
                  </span>
                  {t.is_submitted ? (
                    <span className="badge badge-done">Submitted</span>
                  ) : t.has_draft ? (
                    <span className="badge badge-draft">Draft</span>
                  ) : (
                    <span className="badge badge-pending">Not started</span>
                  )}
                </div>
                <div className="text-muted" style={{ fontSize: "0.88rem" }}>
                  {t.is_submitted || t.has_draft ? (
                    Number(t.late_penalty) > 0 ? (
                      <>
                        Final: <strong>{t.current_total}</strong>/100
                        <span> (raw {t.raw_total}, −{t.late_penalty} late)</span>
                      </>
                    ) : (
                      <>Your score: {t.current_total}/100</>
                    )
                  ) : (
                    "Not scored yet"
                  )}
                </div>
                <div className="team-card-actions">
                  <DriveLink href={t.pdf_drive_link} label="View slides" className="btn btn-outline btn-sm" />
                  <Link className="btn btn-primary btn-sm" to={`/judge/team/${t.id}`}>
                    {t.is_submitted ? "Edit marks" : "Mark team"}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </AppShell>
  );
}
