"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useCan } from "../../workspace-access";
import StatusBadge from "../../status-badge";
type ResumeDetail = {
  fileName: string;
  status: string;
  fileType: string;
  extraction?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    designation?: string | null;
    overallConfidence?: number;
  } | null;
};
export default function ResumeDetail({ params }: PageProps<"/resumes/[id]">) {
  const can = useCan();
  const [id, setId] = useState("");
  const [record, setRecord] = useState<ResumeDetail | null>(null);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void params
      .then(async ({ id: resumeId }) => {
        if (controller.signal.aborted) return;
        setId(resumeId);
        const response = await fetch(`/api/resumes/${resumeId}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Resume request failed");
        const data = (await response.json()) as ResumeDetail;
        if (!controller.signal.aborted) {
          setRecord(data);
          setLoadError("");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLoadError(
            "Could not load this resume. Return to All resumes or reload the page to try again.",
          );
      });
    return () => controller.abort();
  }, [params]);
  async function save(form: FormData) {
    if (!can("resumes.edit")) return;
    const response = await fetch(`/api/resumes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name") || null,
        email: form.get("email") || null,
        phone: form.get("phone") || null,
        designation: form.get("designation") || null,
      }),
    });
    setMessage(response.ok ? "Review saved." : "Could not save review.");
  }
  if (!record)
    return (
      <main className="tool-page">
        <div className="tool-header">
          <div>
            <Link href="/resumes" className="back-link">
              ← All resumes
            </Link>
            <h1>Resume details</h1>
            <p>Candidate information and original file.</p>
          </div>
        </div>
        <section
          className={`tool-panel table-state ${loadError ? "ui-error" : ""}`}
          role={loadError ? "alert" : "status"}
        >
          {loadError || "Loading resume…"}
        </section>
      </main>
    );
  const extraction = record.extraction ?? {};
  return (
    <main className="tool-page">
      <div className="tool-header">
        <div>
          <Link href="/resumes" className="back-link">
            ← All resumes
          </Link>
          <h1>Review resume</h1>
          <p>{record.fileName}</p>
          <StatusBadge status={record.status} />
        </div>
      </div>
      <section className="tool-panel review-layout">
        <div>
          <h2>Original resume</h2>
          <p>Private file · {record.fileType.toUpperCase()}</p>
          {can("resumes.download") && (
            <a
              className="button button-secondary"
              href={`/api/resumes/${id}/file`}
            >
              Open resume
            </a>
          )}
        </div>
        <form action={save} className="review-form">
          <h2>Extracted candidate data</h2>
          <label>
            Name
            <input
              className="tool-input"
              name="name"
              readOnly={!can("resumes.edit")}
              defaultValue={extraction.name ?? ""}
            />
          </label>
          <label>
            Email
            <input
              className="tool-input"
              name="email"
              defaultValue={extraction.email ?? ""}
            />
          </label>
          <label>
            Phone
            <input
              className="tool-input"
              name="phone"
              defaultValue={extraction.phone ?? ""}
            />
          </label>
          <label>
            Designation
            <input
              className="tool-input"
              name="designation"
              defaultValue={extraction.designation ?? ""}
            />
          </label>
          <p>
            Confidence: {Math.round((extraction.overallConfidence ?? 0) * 100)}%
          </p>
          {message && <p>{message}</p>}
          {can("resumes.edit") && (
            <button className="button button-primary">Save review</button>
          )}
        </form>
      </section>
    </main>
  );
}
