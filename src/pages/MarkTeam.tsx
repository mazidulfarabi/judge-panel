import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { CRITERIA, TOTAL_MAX } from "../criteria";
import DocumentViewer from "../components/DocumentViewer";

type TeamData = Record<string, string | number | boolean | null>;

export default function MarkTeam() {
  const { teamId } = useParams<{ teamId: string }>();
  const nav = useNavigate();
  const [team, setTeam] = useState<TeamData | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!teamId) return;
    api<{ team: TeamData }>(`/judge/team/${teamId}`)
      .then(({ team: t }) => {
        setTeam(t);
        const f: Record<string, string> = { team_feedback: String(t.team_feedback || "") };
        for (const c of CRITERIA) {
          f[c.key] = String(t[c.key] ?? "");
          f[`feedback_${c.key}`] = String(t[`feedback_${c.key}`] || "");
        }
        setForm(f);
      })
      .catch((e) => setErr(e.message));
  }, [teamId]);

  const total = useMemo(() => {
    return CRITERIA.reduce((s, c) => s + (Number(form[c.key]) || 0), 0);
  }, [form]);

  function setField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save(submit: boolean) {
    if (!teamId) return;
    setErr("");
    setMsg("");
    setLoading(true);
    try {
      const body: Record<string, string | boolean> = { ...form, submit };
      for (const c of CRITERIA) {
        body[c.key] = form[c.key] || "0";
      }
      await api("/judge/team/" + teamId, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setMsg(submit ? "Marks submitted successfully." : "Draft saved.");
      if (submit) setTimeout(() => nav("/judge"), 800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save(true);
  }

  if (!team && !err) return <div className="layout">Loading…</div>;

  return (
    <div className="layout">
      <nav className="nav-bar">
        <Link className="btn btn-ghost" to="/judge">
          ← Back to teams
        </Link>
        <span style={{ fontWeight: 600 }}>
          Total: {total} / {TOTAL_MAX}
        </span>
      </nav>

      <h1>{String(team?.name || "Team")}</h1>

      <div className="card doc-card" style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ marginTop: 0 }}>Team submission</h2>
        {teamId && (
          <DocumentViewer
            apiPath={`/judge/team/${teamId}/document`}
            driveLink={String(team?.pdf_drive_link || "")}
            title="Team submission"
          />
        )}
      </div>

      <form onSubmit={onSubmit}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Marking criteria</h2>
          {CRITERIA.map((c) => (
            <div key={c.key} className="criterion-row">
              <div>
                <label className="label">
                  {c.label} (0–{c.max})
                </label>
                <input
                  className="input score-input"
                  type="number"
                  min={0}
                  max={c.max}
                  value={form[c.key] ?? ""}
                  onChange={(e) => setField(c.key, e.target.value)}
                  required
                />
                <label className="label" style={{ marginTop: "0.5rem" }}>
                  Feedback for {c.label} (optional)
                </label>
                <textarea
                  className="textarea"
                  value={form[`feedback_${c.key}`] ?? ""}
                  onChange={(e) => setField(`feedback_${c.key}`, e.target.value)}
                  placeholder="Optional criterion-specific feedback"
                />
              </div>
            </div>
          ))}

          <div style={{ marginTop: "1rem" }}>
            <label className="label">Overall team feedback (required)</label>
            <textarea
              className="textarea"
              value={form.team_feedback ?? ""}
              onChange={(e) => setField("team_feedback", e.target.value)}
              required
              placeholder="Mandatory feedback for this team"
              style={{ minHeight: 120 }}
            />
          </div>
        </div>

        {err && <p style={{ color: "var(--danger)" }}>{err}</p>}
        {msg && <p style={{ color: "var(--success)" }}>{msg}</p>}

        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={loading}
            onClick={() => save(false)}
          >
            Save draft
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            Submit marks
          </button>
        </div>
      </form>
    </div>
  );
}
