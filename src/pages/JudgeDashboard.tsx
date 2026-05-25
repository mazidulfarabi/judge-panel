import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, clearSession, getSession } from "../api";
import { drivePreviewUrl } from "../criteria";

type Team = {
  id: string;
  name: string;
  pdf_drive_link: string;
  is_submitted: boolean;
  has_draft: boolean;
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
  const nav = useNavigate();
  const session = getSession();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([
      api<Dashboard>("/judge/dashboard"),
      api<{ teams: Team[] }>("/judge/teams"),
    ])
      .then(([d, t]) => {
        setDash(d);
        setTeams(t.teams);
      })
      .catch((e) => setErr(e.message));
  }, []);

  const pct = dash && dash.assigned > 0 ? Math.round((dash.completed / dash.assigned) * 100) : 0;

  return (
    <div className="layout">
      <nav className="nav-bar">
        <div>
          <h1 style={{ margin: 0 }}>
            Hello, {dash?.display_name || session.name}
          </h1>
          {dash?.title && (
            <p style={{ margin: "0.25rem 0 0", color: "var(--muted)" }}>{dash.title}</p>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link className="btn btn-ghost" to="/leaderboard">
            Leaderboard
          </Link>
          <button
            className="btn btn-ghost"
            onClick={() => {
              clearSession();
              nav("/");
            }}
          >
            Log out
          </button>
        </div>
      </nav>

      {err && <p style={{ color: "var(--danger)" }}>{err}</p>}

      {dash && (
        <>
          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Judging progress</h2>
            <p style={{ fontSize: "1.1rem" }}>
              <strong>{dash.completed}</strong> of <strong>{dash.assigned}</strong> teams
              marked
              {dash.assigned > dash.completed && (
                <span style={{ color: "var(--warning)" }}>
                  {" "}
                  — {dash.assigned - dash.completed} remaining
                </span>
              )}
            </p>
            <div className="progress-bar" style={{ marginTop: "0.75rem" }}>
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="alert alert-warn">{dash.instructions}</div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Case document</h2>
            <p>
              <a href={dash.case_link} target="_blank" rel="noreferrer">
                Open case (Google Drive)
              </a>
            </p>
            <iframe
              className="pdf-frame"
              title="Case"
              src={drivePreviewUrl(dash.case_link)}
            />
          </div>
        </>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Your assigned teams</h2>
        <table>
          <thead>
            <tr>
              <th>Team</th>
              <th>Status</th>
              <th>Score</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>
                  {t.is_submitted ? (
                    <span className="badge badge-done">Submitted</span>
                  ) : t.has_draft ? (
                    <span className="badge badge-pending">Draft</span>
                  ) : (
                    <span className="badge badge-pending">Not started</span>
                  )}
                </td>
                <td>{t.is_submitted || t.has_draft ? `${t.current_total}/100` : "—"}</td>
                <td>
                  <Link className="btn btn-primary" to={`/judge/team/${t.id}`}>
                    {t.is_submitted ? "Edit marks" : "Mark"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!teams.length && !err && (
          <p style={{ color: "var(--muted)" }}>No teams assigned yet. Contact the admin.</p>
        )}
      </div>
    </div>
  );
}
