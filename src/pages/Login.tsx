import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, saveSession } from "../api";
import { BRAND } from "../brand";

export default function Login() {
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"judge" | "admin">("judge");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api<{ token: string; role: "admin" | "judge"; name: string; title?: string }>(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ username, password, role }),
        }
      );
      saveSession(data);
      nav(data.role === "admin" ? "/admin" : "/judge");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-brand">
        <span className="brand-event">{BRAND.event}</span>
        <span className="brand-org">{BRAND.org}</span>
        <span className="brand-portal">{BRAND.portal}</span>
      </div>

      <div className="login-card card">
        <h2 style={{ marginTop: 0, textAlign: "center" }}>Sign in</h2>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label className="label">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as "judge" | "admin")}>
              <option value="judge">Judge</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="field">
            <label className="label">Username</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
