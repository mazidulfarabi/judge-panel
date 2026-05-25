import { FormEvent, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, saveSession } from "../api";

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
      <div className="login-card card">
        <h1 style={{ marginTop: 0 }}>Judging Portal</h1>
        <p style={{ color: "var(--muted)", marginBottom: "1.5rem" }}>
          Case competition — judges &amp; admin access
        </p>
        <form onSubmit={onSubmit}>
          <div style={{ marginBottom: "1rem" }}>
            <label className="label">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as "judge" | "admin")}>
              <option value="judge">Judge</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label className="label">Username</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div style={{ marginBottom: "1.25rem" }}>
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
          {error && (
            <p style={{ color: "var(--danger)", fontSize: "0.9rem" }}>{error}</p>
          )}
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p style={{ marginTop: "1.25rem", fontSize: "0.85rem", color: "var(--muted)" }}>
          <Link to="/leaderboard">View public leaderboard</Link>
        </p>
      </div>
    </div>
  );
}
