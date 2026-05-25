import { Navigate, Route, Routes } from "react-router-dom";
import { getSession } from "./api";
import Login from "./pages/Login";
import JudgeDashboard from "./pages/JudgeDashboard";
import MarkTeam from "./pages/MarkTeam";
import Leaderboard from "./pages/Leaderboard";
import AdminPanel from "./pages/AdminPanel";

function RequireRole({ role, children }: { role: "admin" | "judge"; children: React.ReactNode }) {
  const s = getSession();
  if (!s.token) return <Navigate to="/" replace />;
  if (s.role !== role) return <Navigate to={s.role === "admin" ? "/admin" : "/judge"} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route
        path="/judge"
        element={
          <RequireRole role="judge">
            <JudgeDashboard />
          </RequireRole>
        }
      />
      <Route
        path="/judge/team/:teamId"
        element={
          <RequireRole role="judge">
            <MarkTeam />
          </RequireRole>
        }
      />
      <Route path="/leaderboard" element={<Leaderboard />} />
      <Route
        path="/admin"
        element={
          <RequireRole role="admin">
            <AdminPanel />
          </RequireRole>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
