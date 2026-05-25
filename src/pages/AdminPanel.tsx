import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, downloadZip } from "../api";
import AppShell from "../components/AppShell";

type Stats = { teams: number; judges: number; assignments: number; submissions: number };
type DbStatus = {
  connected: { database: string };
  tables: { table_schema: string; table_name: string }[];
  counts: { judges: number; teams: number; admins: number };
};
type Team = { id: string; name: string; pdf_drive_link: string; judges_assigned: number; judges_scored: number };
type Judge = {
  id: string;
  username: string;
  display_name: string;
  title: string;
  assigned: number;
  completed: number;
};

export default function AdminPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [judges, setJudges] = useState<Judge[]>([]);
  const [csv, setCsv] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const [jUser, setJUser] = useState("");
  const [jPass, setJPass] = useState("");
  const [jName, setJName] = useState("");
  const [jTitle, setJTitle] = useState("");
  const [bulkJudges, setBulkJudges] = useState("");

  const [selJudge, setSelJudge] = useState("");
  const [randCount, setRandCount] = useState(20);
  const [perJudge, setPerJudge] = useState(20);

  function refresh() {
    return Promise.all([
      api<Stats>("/admin/stats"),
      api<{ teams: Team[] }>("/admin/teams"),
      api<{ judges: Judge[] }>("/admin/judges"),
      api<DbStatus>("/admin/db-status"),
    ]).then(([s, t, j, db]) => {
      setStats(s);
      setTeams(t.teams);
      setJudges(j.judges);
      setDbStatus(db);
    });
  }

  useEffect(() => {
    refresh().catch((e) => setErr(e.message));
  }, []);

  async function importTeams() {
    setErr("");
    setMsg("");
    try {
      const r = await api<{ imported: number }>("/admin/teams/import", {
        method: "POST",
        body: JSON.stringify({ csv }),
      });
      setMsg(`Imported ${r.imported} teams from CSV.`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed");
    }
  }

  async function createJudge() {
    setErr("");
    setMsg("");
    try {
      await api("/admin/judges", {
        method: "POST",
        body: JSON.stringify({
          username: jUser,
          password: jPass,
          display_name: jName,
          title: jTitle,
        }),
      });
      setMsg(`Judge ${jName} created.`);
      setJUser("");
      setJPass("");
      setJName("");
      setJTitle("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create judge");
    }
  }

  async function bulkCreateJudges() {
    const lines = bulkJudges.trim().split(/\n/).filter(Boolean);
    const list = lines.map((line) => {
      const [username, password, display_name, title] = line.split(",").map((s) => s.trim());
      return { username, password, display_name, title: title || "" };
    });
    try {
      const r = await api<{ created: unknown[] }>("/admin/judges/bulk", {
        method: "POST",
        body: JSON.stringify({ judges: list }),
      });
      setMsg(`Upserted ${r.created.length} judges.`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Bulk failed");
    }
  }

  async function randomAssign() {
    if (!selJudge) return setErr("Select a judge");
    try {
      const r = await api<{ assigned: number }>("/admin/assign/random", {
        method: "POST",
        body: JSON.stringify({ judge_id: selJudge, count: randCount }),
      });
      setMsg(`Randomly assigned ${r.assigned} teams.`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Assign failed");
    }
  }

  async function bulkAssignAll() {
    if (!selJudge) return setErr("Select a judge");
    try {
      const r = await api<{ assigned: number }>("/admin/assign/bulk", {
        method: "POST",
        body: JSON.stringify({ judge_id: selJudge, team_ids: teams.map((t) => t.id) }),
      });
      setMsg(`Bulk assigned ${r.assigned} teams to judge.`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Bulk assign failed");
    }
  }

  async function autoDistribute() {
    try {
      const r = await api<{ assigned: number }>("/admin/assign/auto-distribute", {
        method: "POST",
        body: JSON.stringify({ per_judge: perJudge }),
      });
      setMsg(`Auto-distributed ${r.assigned} assignments (${perJudge} per judge target).`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Distribute failed");
    }
  }

  async function exportZip() {
    try {
      await downloadZip("/admin/export/scorecards", "scorecards.zip");
      setMsg("Scorecards ZIP downloaded.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Export failed");
    }
  }

  return (
    <AppShell
      title="Admin"
      actions={
        <Link to="/leaderboard" className="btn btn-ghost btn-sm">
          Leaderboard
        </Link>
      }
    >
      {dbStatus && (
        <div className="card">
          <h2>Database</h2>
          <p style={{ margin: "0.25rem 0", fontSize: "0.9rem" }}>
            <strong>Database:</strong> {dbStatus.connected.database}
          </p>
          <p style={{ margin: "0.25rem 0", fontSize: "0.9rem" }}>
            <strong>Tables:</strong>{" "}
            {dbStatus.tables.length
              ? dbStatus.tables.map((t) => `${t.table_schema}.${t.table_name}`).join(", ")
              : "none"}
            {" · "}
            <strong>Rows:</strong> {dbStatus.counts.judges} judges, {dbStatus.counts.teams} teams,{" "}
            {dbStatus.counts.admins} admins
          </p>
        </div>
      )}

      {stats && (
        <div className="stat-grid" style={{ marginBottom: "1rem" }}>
          {[
            ["Teams", stats.teams],
            ["Judges", stats.judges],
            ["Assignments", stats.assignments],
            ["Submissions", stats.submissions],
          ].map(([label, val]) => (
            <div key={String(label)} className="card stat-box">
              <div className="stat-num">{val}</div>
              <div className="stat-label">{label}</div>
            </div>
          ))}
        </div>
      )}

      {msg && <div className="alert alert-success">{msg}</div>}
      {err && <div className="alert alert-error">{err}</div>}

      <div className="card">
        <h2>Import teams (CSV)</h2>
        <p className="text-muted" style={{ fontSize: "0.9rem" }}>
          Format: <code>team_name,pdf_drive_link</code> — one team per line.
        </p>
        <textarea
          className="textarea"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={"Team Alpha,https://drive.google.com/file/d/...\nTeam Beta,https://drive.google.com/..."}
          style={{ minHeight: 120 }}
        />
        <button className="btn btn-primary" style={{ marginTop: "0.75rem" }} onClick={importTeams}>
          Import CSV
        </button>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Add judge</h2>
          <div className="field">
            <label className="label">Username</label>
            <input className="input" value={jUser} onChange={(e) => setJUser(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Password</label>
            <input className="input" type="text" value={jPass} onChange={(e) => setJPass(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Display name</label>
            <input className="input" value={jName} onChange={(e) => setJName(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Title</label>
            <input className="input" value={jTitle} onChange={(e) => setJTitle(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-block" onClick={createJudge}>
            Create judge
          </button>
        </div>
        <div className="card">
          <h2>Bulk judges</h2>
          <p className="text-muted" style={{ fontSize: "0.85rem" }}>
            One per line: username,password,display name,title
          </p>
          <textarea
            className="textarea"
            value={bulkJudges}
            onChange={(e) => setBulkJudges(e.target.value)}
            style={{ minHeight: 100 }}
          />
          <button className="btn btn-primary btn-block" style={{ marginTop: "0.75rem" }} onClick={bulkCreateJudges}>
            Bulk create
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Assignments</h2>
        <div className="field">
          <label className="label">Judge</label>
          <select value={selJudge} onChange={(e) => setSelJudge(e.target.value)}>
            <option value="">Select judge…</option>
            {judges.map((j) => (
              <option key={j.id} value={j.id}>
                {j.display_name} ({j.assigned} assigned, {j.completed} done)
              </option>
            ))}
          </select>
        </div>
        <div className="team-card-actions" style={{ marginTop: "0.75rem" }}>
          <div className="field" style={{ flex: "1 1 100px", marginBottom: 0 }}>
            <label className="label">Random count</label>
            <input
              className="input"
              type="number"
              value={randCount}
              onChange={(e) => setRandCount(Number(e.target.value))}
            />
          </div>
          <button className="btn btn-primary" onClick={randomAssign}>
            Random assign
          </button>
          <button className="btn btn-outline" onClick={bulkAssignAll}>
            Assign all teams
          </button>
        </div>
        <div className="team-card-actions" style={{ marginTop: "0.75rem" }}>
          <div className="field" style={{ flex: "1 1 100px", marginBottom: 0 }}>
            <label className="label">Per judge</label>
            <input
              className="input"
              type="number"
              value={perJudge}
              onChange={(e) => setPerJudge(Number(e.target.value))}
            />
          </div>
          <button className="btn btn-primary" onClick={autoDistribute}>
            Auto-distribute
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Export scorecards</h2>
        <p className="text-muted">ZIP of PDF scorecards per team (submitted marks only).</p>
        <button className="btn btn-primary" onClick={exportZip}>
          Download ZIP
        </button>
      </div>

      <div className="card">
        <h2>Judges</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Assigned</th>
                <th>Done</th>
              </tr>
            </thead>
            <tbody>
              {judges.map((j) => (
                <tr key={j.id}>
                  <td>
                    {j.display_name}
                    {j.title && <span className="text-muted"> — {j.title}</span>}
                  </td>
                  <td>{j.username}</td>
                  <td>{j.assigned}</td>
                  <td>{j.completed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Teams</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Team</th>
                <th>Assigned</th>
                <th>Scored</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.judges_assigned}</td>
                  <td>{t.judges_scored}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
