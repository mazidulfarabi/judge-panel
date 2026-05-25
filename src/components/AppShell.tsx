import { Link, useNavigate } from "react-router-dom";
import { clearSession, getSession } from "../api";
import { BRAND } from "../brand";

type Props = {
  children: React.ReactNode;
  title?: string;
  backTo?: { label: string; path: string };
  actions?: React.ReactNode;
};

export default function AppShell({ children, title, backTo, actions }: Props) {
  const nav = useNavigate();
  const session = getSession();
  const home = session.role === "admin" ? "/admin" : "/judge";

  return (
    <div className="app">
      <header className="site-header">
        <div className="site-header-inner">
          <Link to={home} className="brand-lockup">
            <span className="brand-event">{BRAND.event}</span>
            <span className="brand-org">{BRAND.org}</span>
            <span className="brand-portal">{BRAND.portal}</span>
          </Link>
          <div className="site-header-actions">
            {actions}
            {session.token && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  clearSession();
                  nav("/");
                }}
              >
                Log out
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="main">
        {(title || backTo) && (
          <div className="page-head">
            {backTo && (
              <Link to={backTo.path} className="back-link">
                ← {backTo.label}
              </Link>
            )}
            {title && <h1 className="page-title">{title}</h1>}
          </div>
        )}
        {children}
      </main>

      <footer className="site-footer">
        <p>
          {BRAND.full} · {BRAND.portal}
        </p>
      </footer>
    </div>
  );
}
