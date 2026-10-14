"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useCan } from "./workspace-access";
import StatusBadge from "./status-badge";
import { experienceLabel } from "@/lib/resume-review";
import type { ResumeOverviewRow } from "@/lib/resume-overview";

type ResumeRow = ResumeOverviewRow;
export default function ResumeList({
  title,
  status,
}: {
  title: string;
  status?: string;
}) {
  const can = useCan();
  const showSummary = can("dashboard.view");
  const [items, setItems] = useState<ResumeRow[]>([]);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const activeStatus = status || filterStatus;
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<{
    total: number;
    successful: number;
    review: number;
  } | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const requestKey = JSON.stringify([page, search, activeStatus]);
  const loading = loadedKey !== requestKey;
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), limit: "25" });
    if (activeStatus) params.set("status", activeStatus);
    if (search) params.set("search", search);
    void fetch(`/api/resumes?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Resume request failed");
        const data = await response.json();
        if (controller.signal.aborted) return;
        setItems(data.items);
        setTotal(data.total);
        setPages(data.pages || 1);
        setError("");
        setLoadedKey(requestKey);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(
            "Could not load resumes. Please reload the page to try again.",
          );
          setLoadedKey(requestKey);
        }
      });
    return () => controller.abort();
  }, [page, search, activeStatus, requestKey]);
  useEffect(() => {
    if (status || !showSummary) return;
    const controller = new AbortController();
    void fetch("/api/dashboard/stats", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Summary request failed");
        const data = await response.json();
        if (!controller.signal.aborted) {
          setSummary({
            total: data.total,
            successful: data.successful,
            review: data.review,
          });
          setSummaryError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setSummaryError(true);
      });
    return () => controller.abort();
  }, [status, showSummary]);
  const subtitle =
    status === "REVIEW"
      ? "Review candidate information that needs your attention."
      : status === "DUPLICATE"
        ? "Inspect duplicate resumes and candidate records."
        : status === "FAILED"
          ? "Inspect resumes that could not be processed."
          : "Manage, review and organize candidate resumes.";
  const emptyTitle = search
    ? "No matching resumes"
    : status
      ? "No resumes in this queue"
      : "No resumes yet";
  const emptyDescription = search
    ? "Try another name, email or file name."
    : status
      ? "There are currently no resumes with this processing status."
      : "Import your first resume batch to get started.";
  return (
    <main className="tool-page resume-list-page">
      <div className="tool-header">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
          <span className="count-badge">
            {loading
              ? "Loading records…"
              : error
                ? "Records unavailable"
                : `${total.toLocaleString()} ${search ? "matching resumes" : "resumes in this view"}`}
          </span>
        </div>
        {can("resumes.import") && (
          <Link className="button button-primary" href="/import">
            ＋ Import resumes
          </Link>
        )}
      </div>
      {!status && showSummary && (
        <section className="summary-grid" aria-label="Resume summary">
          {[
            { label: "Total resumes", value: summary?.total, icon: "▤" },
            { label: "Completed", value: summary?.successful, icon: "✓" },
            { label: "Needs review", value: summary?.review, icon: "◷" },
          ].map((metric) => (
            <article
              className="summary-card"
              key={metric.label}
              aria-busy={!summaryError && metric.value === undefined}
            >
              <div>
                <span>{metric.label}</span>
                <strong>
                  {summaryError
                    ? "—"
                    : metric.value === undefined
                      ? "Loading…"
                      : metric.value.toLocaleString()}
                </strong>
              </div>
              <span className="summary-icon" aria-hidden="true">
                {metric.icon}
              </span>
            </article>
          ))}
          {summaryError && (
            <p className="ui-error" role="alert">
              Summary counts are unavailable. Resume records can still be viewed
              below.
            </p>
          )}
        </section>
      )}
      <section className="panel table-panel">
        <div className="table-heading">
          <div>
            <h2>Resume records</h2>
            <p>Candidate information and processing status.</p>
          </div>
        </div>
        <div className="table-toolbar">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="Search resumes"
              placeholder="Search by name, email or file…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
          {!status && (
            <label>
              Processing status
              <select
                className="tool-input"
                aria-label="Filter by processing status"
                value={filterStatus}
                onChange={(e) => {
                  setFilterStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                {[
                  "PENDING",
                  "PROCESSING",
                  "COMPLETED",
                  "REVIEW",
                  "FAILED",
                  "DUPLICATE",
                  "CANCELLED",
                ].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
          {can("resumes.export") && (
            <Link href="/export" className="filter-button">
              ⇩ Export
            </Link>
          )}
        </div>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label={`${title} table`}
          aria-busy={loading}
        >
          <table>
            <thead>
              <tr>
                <th>FILE / CANDIDATE</th>
                <th>EMAIL</th>
                <th>PHONE</th>
                <th>DESIGNATION</th>
                <th>LOCATION</th>
                <th>EXPERIENCE</th>
                <th>TOP SKILLS</th>
                <th>HIGHEST IDENTIFIED EDUCATION</th>
                <th>CONFIDENCE</th>
                <th>STATUS</th>
                <th>CREATED</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                !error &&
                items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link
                        className="candidate-cell"
                        href={`/resumes/${row.id}`}
                      >
                        <span className="candidate-avatar tone-violet">
                          {(row.overview?.name ?? row.extraction?.name ?? "CV")
                            .slice(0, 2)
                            .toUpperCase()}
                        </span>
                        <div>
                          <b>
                            {row.overview?.name ??
                              row.extraction?.name ??
                              "Identity not identified"}
                          </b>
                          <span>{row.fileName}</span>
                        </div>
                      </Link>
                    </td>
                    <td>{row.extraction?.email ?? "—"}</td>
                    <td>{row.extraction?.phone ?? "—"}</td>
                    <td>
                      {row.overview?.designation ??
                        row.extraction?.designation ??
                        "—"}
                    </td>
                    <td>{row.overview?.location ?? "—"}</td>
                    <td>
                      {experienceLabel(row.overview?.totalExperienceMonths)}
                    </td>
                    <td>
                      <span className="resume-table-skills">
                        {row.overview?.skills.join(", ") || "—"}
                      </span>
                    </td>
                    <td>{row.overview?.education ?? "—"}</td>
                    <td>
                      {row.extraction
                        ? `${Math.round(row.extraction.overallConfidence * 100)}%`
                        : "—"}
                    </td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                    <td>
                      <Link href={`/resumes/${row.id}`} className="back-link">
                        {row.status === "REVIEW" && can("resumes.edit")
                          ? "Review"
                          : "View"}
                      </Link>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {loading ? (
          <div className="table-state" role="status">
            <span className="loading-dot" />
            Loading resume records…
          </div>
        ) : error ? (
          <div className="table-state ui-error" role="alert">
            <strong>Resume records unavailable</strong>
            <p>{error}</p>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        ) : (
          items.length === 0 && (
            <div className="empty-search">
              <strong>{emptyTitle}</strong>
              <p>{emptyDescription}</p>
              {!status && !search && can("resumes.import") && (
                <Link className="button button-secondary" href="/import">
                  Import resumes
                </Link>
              )}
            </div>
          )
        )}
        <div className="table-footer">
          <span>
            {loading
              ? "Loading records…"
              : error
                ? "Records unavailable"
                : `Page ${page} of ${pages}`}
          </span>
          <div className="pagination">
            <button
              aria-label="Previous page"
              disabled={loading || !!error || page <= 1}
              onClick={() => setPage(page - 1)}
            >
              ←
            </button>
            <button
              aria-label="Next page"
              disabled={loading || !!error || page >= pages}
              onClick={() => setPage(page + 1)}
            >
              →
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
