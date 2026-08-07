import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <main style={{ display: "grid", placeItems: "center", height: "100vh", textAlign: "center", gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>404 — UNKNOWN ROUTE</h1>
        <p style={{ color: "var(--nc-slate-300)" }}>
          <Link to="/">Return to launch</Link>
        </p>
      </div>
    </main>
  );
}
