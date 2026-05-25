import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

type Row = {
  id: string;
  name: string;
  judges_scored: number;
  avg_total: string;
};

export default function Leaderboard() {
  const [teams, setTeams] = useState<Row[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    api<{ teams: Row[] }>("/leaderboard")
      .then((d) => setTeams(d.teams))
      .catch((e) => setErr(e.message));
  }, []);

  return (
    <div className="layout">
      <nav className="nav-bar">
        <h1 style={{ margin: 0 }}>Leaderboard</h1>
        <Link className="btn btn-ghost" to="/">
          Login
        </Link>
      </nav>
      <p style={{ color: "var(--muted)" }}>
        Rankings by average total score across judges who have submitted marks.
      </p>
      {err && <p style={{ color: "var(--danger)" }}>{err}</p>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              <th>Avg score</th>
              <th>Judges scored</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t, i) => (
              <tr key={t.id}>
                <td>{i + 1}</td>
                <td>{t.name}</td>
                <td>
                  <strong>{Number(t.avg_total).toFixed(2)}</strong> / 100
                </td>
                <td>{t.judges_scored}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!teams.length && !err && (
          <p style={{ color: "var(--muted)" }}>No submitted scores yet.</p>
        )}
      </div>
    </div>
  );
}
