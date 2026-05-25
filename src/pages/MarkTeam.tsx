import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import AppShell from "../components/AppShell";
import CriterionField from "../components/CriterionField";
import DriveLink from "../components/DriveLink";
import { CRITERIA, TOTAL_MAX, adjustedTotal, rawTotalFromScores } from "../criteria";
import LatePenaltyBadge from "../components/LatePenaltyBadge";

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
          f[c.key] = String(t[c.key] ?? "0");
          f[`feedback_${c.key}`] = String(t[`feedback_${c.key}`] || "");
        }
        setForm(f);
      })
      .catch((e) => setErr(e.message));
  }, [teamId]);

  const latePenalty = Number(team?.late_penalty) || 0;
  const rawTotal = useMemo(() => rawTotalFromScores(form), [form]);
  const finalTotal = useMemo(
    () => adjustedTotal(rawTotal, latePenalty),
    [rawTotal, latePenalty]
  );

  function setField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save(submit: boolean) {
    if (!teamId) return;

    if (submit && !String(form.team_feedback || "").trim()) {
      setErr("Overall team feedback is required when submitting marks.");
      return;
    }

    setErr("");
    setMsg("");
    setLoading(true);
    try {
      const body: Record<string, string | boolean> = { ...form, submit };
      for (const c of CRITERIA) {
        body[c.key] = form[c.key] ?? "0";
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

  if (!team && !err) {
    return (
      <AppShell backTo={{ label: "Dashboard", path: "/judge" }}>
        <p className="text-muted">Loading…</p>
      </AppShell>
    );
  }

  return (
    <AppShell
      backTo={{ label: "Dashboard", path: "/judge" }}
      title={String(team?.name || "Team")}
      actions={
        <span className="total-pill">
          {latePenalty > 0 ? (
            <>
              {finalTotal}
              <span style={{ opacity: 0.85, fontWeight: 500 }}> ({rawTotal}−{latePenalty})</span>
            </>
          ) : (
            rawTotal
          )}
          {" "}/ {TOTAL_MAX}
        </span>
      }
    >
      {latePenalty > 0 && (
        <div className="alert alert-warn" style={{ marginBottom: "1rem" }}>
          Late submission: <strong>−{latePenalty} points</strong> applied to final score.
        </div>
      )}

      <div className="card">
        <h2>
          Team submission
          <LatePenaltyBadge penalty={latePenalty} style={{ marginLeft: "0.5rem", verticalAlign: "middle" }} />
        </h2>
        <p className="text-muted" style={{ marginTop: 0, fontSize: "0.9rem" }}>
          Review the slides in a new tab while marking.
        </p>
        <DriveLink href={String(team?.pdf_drive_link || "")} label="Open slides in new tab" className="btn btn-primary btn-block" />
      </div>

      <form onSubmit={onSubmit}>
        <div className="card">
          <h2>Marking criteria</h2>
          {CRITERIA.map((c) => (
            <CriterionField
              key={c.key}
              label={c.label}
              max={c.max}
              score={Number(form[c.key]) || 0}
              feedback={form[`feedback_${c.key}`] ?? ""}
              onScore={(n) => setField(c.key, String(n))}
              onFeedback={(text) => setField(`feedback_${c.key}`, text)}
            />
          ))}

          <div className="field" style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
            <label className="label">Overall team feedback</label>
            <p className="text-muted" style={{ fontSize: "0.85rem", margin: "0 0 0.5rem" }}>
              Optional for drafts · required when you submit
            </p>
            <textarea
              className="textarea"
              value={form.team_feedback ?? ""}
              onChange={(e) => setField("team_feedback", e.target.value)}
              placeholder="Summary feedback for this team"
              rows={4}
            />
          </div>
        </div>

        {err && <div className="alert alert-error">{err}</div>}
        {msg && <div className="alert alert-success">{msg}</div>}

        <div className="mark-actions">
          <button
            type="button"
            className="btn btn-ghost btn-block"
            disabled={loading}
            onClick={() => save(false)}
          >
            Save draft
          </button>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            Submit marks
          </button>
        </div>
      </form>
    </AppShell>
  );
}
