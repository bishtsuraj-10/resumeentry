"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useEffect, useMemo, useState } from "react";
import { useCan } from "./workspace-access";
import StatusBadge from "./status-badge";

type Row = {
  id: string;
  initials: string;
  tone: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  score: number;
  status: string;
  file: string;
  date: string;
};
type Stats = {
  total: number;
  processed: number;
  pending: number;
  processing: number;
  remaining: number;
  successful: number;
  review: number;
  failed: number;
  duplicates: number;
  speedPerMinute: number;
  etaSeconds: number | null;
  percentage: number;
};

function Icon({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

export default function Home() {
  const router = useRouter();
  const can = useCan();
  const showResumes = can("resumes.view");
  const [loadError, setLoadError] = useState("");
  const [recordsError, setRecordsError] = useState("");
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<Row[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    const load = async () => {
      const [statsResponse, resumesResponse] = await Promise.all([
        fetch("/api/dashboard/stats"),
        showResumes ? fetch("/api/resumes?limit=5") : Promise.resolve(null),
      ]);
      if (statsResponse.ok) {
        setStats(await statsResponse.json());
        setLoadError("");
      } else
        setLoadError(
          "Could not load dashboard statistics. Reload to try again.",
        );
      if (resumesResponse?.ok) {
        const data = await resumesResponse.json();
        setRecordsError("");
        setRecords(
          data.items.map(
            (resume: {
              id: string;
              fileName: string;
              status: string;
              createdAt: string;
              extraction?: {
                name?: string;
                email?: string;
                phone?: string;
                designation?: string;
                overallConfidence?: number;
              };
            }) => ({
              id: resume.id,
              file: resume.fileName,
              name: resume.extraction?.name ?? "Needs review",
              role: resume.extraction?.designation ?? "Designation not found",
              email: resume.extraction?.email ?? "—",
              phone: resume.extraction?.phone ?? "—",
              score: Math.round(
                (resume.extraction?.overallConfidence ?? 0) * 100,
              ),
              status:
                resume.status === "COMPLETED"
                  ? "Complete"
                  : resume.status === "REVIEW"
                    ? "Review"
                    : resume.status,
              date: new Date(resume.createdAt).toLocaleString(),
              initials: (resume.extraction?.name ?? "CV")
                .split(" ")
                .slice(0, 2)
                .map((part) => part[0])
                .join("")
                .toUpperCase(),
              tone: "violet",
            }),
          ),
        );
      } else if (resumesResponse) {
        setRecords([]);
        setRecordsError("Recent resumes are unavailable.");
      }
    };
    void load().catch(() =>
      setLoadError("Could not load dashboard data. Reload to try again."),
    );
    const interval = window.setInterval(
      () =>
        void load().catch(() =>
          setLoadError("Could not refresh dashboard data."),
        ),
      10_000,
    );
    return () => window.clearInterval(interval);
  }, [showResumes]);
  const visible = useMemo(
    () =>
      records.filter((r) =>
        `${r.name} ${r.role} ${r.email} ${r.file}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [records, query],
  );

  if (!stats)
    return (
      <main className="tool-page">
        <header className="tool-header">
          <div>
            <h1>Workspace overview</h1>
          </div>
        </header>
        <section
          className={loadError ? "ui-error" : "tool-panel table-state"}
          role={loadError ? "alert" : "status"}
        >
          {loadError || "Loading dashboard…"}
        </section>
      </main>
    );
  const eta =
    stats.etaSeconds === null
      ? stats.remaining
        ? "Calculating…"
        : "—"
      : `${Math.floor(stats.etaSeconds / 3600)}h ${Math.floor((stats.etaSeconds % 3600) / 60)}m`;
  return (
    <main className="dashboard-content">
      {loadError && (
        <p className="ui-error" role="alert">
          {loadError}
        </p>
      )}
      <section className="welcome-row">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> WORKSPACE OVERVIEW
          </div>
          <h1>
            Your resume workspace <span className="wave">✳</span>
          </h1>
          <p className="welcome-subtitle">
            Here&apos;s what&apos;s happening with your resumes today.
          </p>
        </div>
        <div className="welcome-actions">
          {can("resumes.export") && (
            <button
              className="button button-secondary"
              onClick={() => router.push("/export")}
            >
              <Icon>⇩</Icon> Export report
            </button>
          )}
          {can("resumes.import") && (
            <button
              className="button button-primary"
              onClick={() => router.push("/import")}
            >
              <Icon>＋</Icon> Import resumes
            </button>
          )}
        </div>
      </section>

      <section className="stat-grid" aria-label="Resume processing metrics">
        <article className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Total resumes</span>
            <span className="stat-icon purple-icon">▤</span>
          </div>
          <div className="stat-value">{stats.total.toLocaleString()}</div>
          <div className="stat-foot">
            <span className="trend-blue">In your workspace</span>
          </div>
        </article>
        <article className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Successfully processed</span>
            <span className="stat-icon green-icon">✓</span>
          </div>
          <div className="stat-value">{stats.successful.toLocaleString()}</div>
          <div className="stat-foot">
            <span className="trend-up">
              {stats.pending.toLocaleString()} pending
            </span>
            <span>in processing queue</span>
          </div>
        </article>
        <article className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Needs review</span>
            <span className="stat-icon amber-icon">◷</span>
          </div>
          <div className="stat-value">{stats.review.toLocaleString()}</div>
          <div className="stat-foot">
            <span className="trend-neutral">Below confidence threshold</span>
          </div>
        </article>
        <article className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Duplicates found</span>
            <span className="stat-icon blue-icon">⧉</span>
          </div>
          <div className="stat-value">{stats.duplicates.toLocaleString()}</div>
          <div className="stat-foot">
            <span className="trend-blue">Across all batches</span>
          </div>
        </article>
      </section>

      <section className="middle-grid">
        <article className="panel progress-panel">
          <div className="panel-heading">
            <div>
              <h2>Processing activity</h2>
              <p>Track your resume processing in real time</p>
            </div>
            <span className="select-button">Live status</span>
          </div>
          <div className="progress-content">
            <div
              className="progress-ring"
              style={{
                background: `conic-gradient(var(--accent) 0deg ${stats.percentage * 3.6}deg,var(--track) ${stats.percentage * 3.6}deg 360deg)`,
              }}
              role="img"
              aria-label={`${stats.percentage} percent processed`}
            >
              <div className="ring-inner">
                <strong>
                  {stats.percentage}
                  <span>%</span>
                </strong>
                <small>completed</small>
              </div>
            </div>
            <div className="progress-details">
              <div className="progress-title">
                <span className="live-dot" />
                {stats.remaining
                  ? "Processing queue active"
                  : "Queue is up to date"}
              </div>
              <p>{stats.processed.toLocaleString()} resumes processed</p>
              <div className="progress-line">
                <i style={{ width: `${stats.percentage}%` }} />
              </div>
              <div className="progress-numbers">
                <strong>
                  {stats.processed.toLocaleString()}{" "}
                  <span>/ {stats.total.toLocaleString()}</span>
                </strong>
                <span>{stats.remaining.toLocaleString()} remaining</span>
              </div>
              <div className="progress-meta">
                <span>
                  <i className="meta-dot green-dot" />{" "}
                  {stats.successful.toLocaleString()} successful
                </span>
                <span>
                  <i className="meta-dot amber-dot" />{" "}
                  {stats.review.toLocaleString()} in review
                </span>
              </div>
            </div>
          </div>
          <div className="progress-footer">
            <div>
              <span className="footer-label">Failed resumes</span>
              <strong>{stats.failed.toLocaleString()}</strong>
            </div>
            <div>
              <span className="footer-label">Processing speed</span>
              <strong>
                {stats.speedPerMinute.toLocaleString()}{" "}
                <small>resumes/min</small>
              </strong>
            </div>
            <div>
              <span className="footer-label">Est. time remaining</span>
              <strong>{eta}</strong>
            </div>
            {can("batches.view") && (
              <button
                className="pause-button"
                aria-label="Processing activity"
                onClick={() => router.push("/batches")}
              >
                ···
              </button>
            )}
          </div>
        </article>
        <article className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <h2>Recent activity</h2>
              <p>What&apos;s happening in your workspace</p>
            </div>
            <button className="more-button">···</button>
          </div>
          <div className="activity-list">
            <div className="activity-item">
              <span className="activity-symbol activity-purple">↑</span>
              <div>
                <p>
                  <b>{stats.total.toLocaleString()} resumes in workspace</b>
                  <span>
                    {stats.processed.toLocaleString()} processed ·{" "}
                    {stats.pending.toLocaleString()} pending
                  </span>
                </p>
              </div>
            </div>
            <div className="activity-item">
              <span className="activity-symbol activity-amber">◷</span>
              <div>
                <p>
                  <b>Review queue</b>
                  <span>
                    {stats.review.toLocaleString()} resumes need your attention
                  </span>
                </p>
              </div>
            </div>
            <div className="activity-item">
              <span className="activity-symbol activity-blue">!</span>
              <div>
                <p>
                  <b>Failed processing</b>
                  <span>
                    {stats.failed.toLocaleString()} resumes could not be
                    processed
                  </span>
                </p>
              </div>
            </div>
          </div>
          {can("batches.view") && (
            <Link className="activity-link" href="/batches">
              View processing batches <span>→</span>
            </Link>
          )}
        </article>
      </section>

      {showResumes && (
        <section className="panel table-panel">
          <div className="table-heading">
            <div>
              <h2>Recently processed resumes</h2>
              <p>A quick look at your latest candidate profiles</p>
            </div>
            <Link href="/resumes" className="view-all">
              View all resumes <span>→</span>
            </Link>
          </div>
          <div className="table-toolbar">
            <label className="search-box">
              <span>⌕</span>
              <input
                aria-label="Search resumes"
                placeholder="Search by name, email or file..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>⌘ K</kbd>
            </label>
            <Link className="filter-button" href="/resumes">
              ☷ <span>Filters</span>
            </Link>
            <button className="filter-button">
              ⇅ <span>Newest</span>
            </button>
          </div>
          {recordsError && (
            <p className="ui-error" role="alert">
              {recordsError}
            </p>
          )}
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Recently processed resumes table"
          >
            <table>
              <thead>
                <tr>
                  <th />
                  <th>FILE / CANDIDATE</th>
                  <th>CONTACT</th>
                  <th>CONFIDENCE</th>
                  <th>STATUS</th>
                  <th>ADDED</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input type="checkbox" aria-label={`Select ${r.name}`} />
                    </td>
                    <td>
                      <div className="candidate-cell">
                        <span className={`candidate-avatar tone-${r.tone}`}>
                          {r.initials}
                        </span>
                        <div>
                          <b>{r.name}</b>
                          <span>
                            {r.file} · {r.role}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="contact-cell">
                        <b>{r.email}</b>
                        <span>{r.phone}</span>
                      </div>
                    </td>
                    <td>
                      <div className="confidence-cell">
                        <div className="confidence-bar">
                          <i style={{ width: `${r.score}%` }} />
                        </div>
                        <b>{r.score}%</b>
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td>
                      <span className="date-cell">{r.date}</span>
                    </td>
                    <td>
                      <button
                        className="more-button"
                        aria-label={`More actions for ${r.name}`}
                      >
                        ···
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!recordsError && visible.length === 0 && (
              <div className="empty-search">
                {query
                  ? `No resumes match “${query}”.`
                  : "No resumes uploaded yet. Import a batch to get started."}
              </div>
            )}
          </div>
          <div className="table-footer">
            <span>
              Showing <b>{visible.length ? "1–" + visible.length : "0"}</b> of{" "}
              <b>{stats.total.toLocaleString()}</b> resumes
            </span>
            <div className="pagination">
              <Link href="/resumes" className="filter-button">
                View all
              </Link>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
