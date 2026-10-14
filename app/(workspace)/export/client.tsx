"use client";
import { useState } from "react";
export default function ExportPage() {
  const [status, setStatus] = useState("ALL");
  return (
    <main className="tool-page">
      <div className="tool-header">
        <div>
          <h1>Export resumes</h1>
          <p>Generate an Excel workbook on the server with streaming rows.</p>
        </div>
      </div>
      <section className="tool-panel export-panel">
        <label className="tool-label">
          Include resumes
          <select
            className="tool-input"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="ALL">All resumes</option>
            <option value="COMPLETED">Completed</option>
            <option value="REVIEWED">Reviewed by administrator</option>
            <option value="REVIEW">Needs review</option>
            <option value="FAILED">Failed</option>
          </select>
        </label>
        <p>
          The Excel export includes candidate fields, per-field confidence
          scores, processing status and creation date.
        </p>
        <a
          className="button button-primary"
          href={`/api/export?status=${status}`}
        >
          ⇩ Download Excel file
        </a>
      </section>
    </main>
  );
}
