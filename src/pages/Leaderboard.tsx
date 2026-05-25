import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, getSession } from "../api";
import AppShell from "../components/AppShell";
import DriveLink from "../components/DriveLink";

type Row = {
  id: string;
  name: string;
  pdf_drive_link: string;
  judges_scored: number;
  avg_total: string | null;
};

export default function Leaderboard() {
  const session = getSession();
  const [teams, setTeams] = useState<Row[]>([]);
  const [err, setErr] = useState("");
  const home = session.role === "admin" ? "/admin" : "/judge";

  useEffect(() => {
    api<{ teams: Row[] }>("/leaderboard")
      .then((d) => setTeams(d.teams))
      .catch((e) => setErr(e.message));
  }, []);

  const ranked = useMemo(() => {
    let rank = 0;
    return teams.map((t) => {
      const avg =
        t.avg_total != null && Number(t.judges_scored) > 0 ? Number(t.avg_total) : null;
      if (avg != null) rank += 1;
      return { ...t, avg, rank: avg != null ? rank : null };
    });
  }, [teams]);

  return (
    <AppShell
      title="Leaderboard"
      backTo={{ label: session.role === "admin" ? "Admin" : "Dashboard", path: home }}
    >
      <p className="text-muted" style={{ marginTop: "-0.5rem" }}>
        Compare teams and open each submission. Average scores appear once judges have submitted marks.
      </p>

      {err && <div className="alert alert-error">{err}</div>}

      <div className="card">
        {!ranked.length && !err ? (
          <p className="text-muted">No teams yet.</p>
        ) : (
          <div className="lb-list">
            {ranked.map((t) => (
              <div key={t.id} className="lb-card">
                <span className="lb-rank">{t.rank ?? "—"}</span>
                <div>
                  <div className="lb-name">{t.name}</div>
                  <div className="lb-meta">
                    {Number(t.judges_scored) > 0
                      ? `${t.judges_scored} judge${Number(t.judges_scored) === 1 ? "" : "s"} scored`
                      : "No scores yet"}
                  </div>
                </div>
                <div className="lb-score">
                  {t.avg != null ? (
                    <>
                      {t.avg.toFixed(1)}
                      <span className="text-muted" style={{ fontWeight: 400 }}>
                        {" "}
                        /100
                      </span>
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </div>
                <DriveLink
                  href={t.pdf_drive_link}
                  label="Open slides"
                  className="btn btn-outline btn-sm"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
