"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useCan } from "../../workspace-access";
import {
  dateLabel,
  experienceLabel,
  loadResume,
  requestJson,
  type ResumeView,
  type RunView,
} from "@/lib/resume-review";

import PdfPreview from "./pdf-preview";
import { mergeReviewDrafts, verificationPrefix } from "@/lib/review-workspace";
import { CandidateHeader, ReviewNavigation } from "./review-chrome";
import { FieldEditor, VerificationContext, Value, Empty, Bullets, External, ReviewMark, VerifiedFields, storedValues, identityFields, profileFields, recordFields, type Draft, type DraftHandler, type Patch } from "./review-fields";

export default function ResumeDetail({ id }: { id: string }) {
  const can = useCan(),
    editable = can("resumes.edit");
  const [record, setRecord] = useState<ResumeView | null>(null),
    [loadedId, setLoadedId] = useState("");
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0),
    [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<RunView[]>([]),
    [evidenceOpen, setEvidenceOpen] = useState(false),
    [evidenceError, setEvidenceError] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [runPage, setRunPage] = useState(1),
    [evidencePage, setEvidencePage] = useState(1),
    [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [runEvidence, setRunEvidence] = useState<RunView | null>(null),
    [evidenceBusy, setEvidenceBusy] = useState(false);
  const drafts = useRef(new Map<string, Draft>());
  const [draftCount, setDraftCount] = useState(0);
  const [saveError, setSaveError] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const lastLoadedId = useRef("");
  const [panelWidth, setPanelWidth] = useState(55);
  const currentId = useRef(id);
  useEffect(() => {
    currentId.current = id;
  }, [id]);
  const onDraft = useCallback<DraftHandler>((token, draft) => {
    if (draft) drafts.current.set(token, draft);
    else drafts.current.delete(token);
    setDraftCount(drafts.current.size);
  }, []);
  useEffect(() => {
    if (!draftCount) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (
        link &&
        link.target !== "_blank" &&
        link.origin === location.origin &&
        (link.pathname !== location.pathname ||
          link.search !== location.search) &&
        !window.confirm(
          "You have unsaved corrections. Leave this candidate and discard them?",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const reviewUrl = location.href;
    const reviewHistory = history.state;
    const pop = (event: PopStateEvent) => {
      if (
        !window.confirm(
          "You have unsaved corrections. Leave this candidate and discard them?",
        )
      ) {
        event.stopImmediatePropagation();
        history.pushState(reviewHistory, "", reviewUrl);
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    window.addEventListener("popstate", pop, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
      window.removeEventListener("popstate", pop, true);
    };
  }, [draftCount]);
  const saveController = useRef<AbortController | null>(null),
    saving = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await loadResume(id, controller.signal);
        if (!controller.signal.aborted) {
          setRecord(result);
          lastLoadedId.current = id;
          setRefreshRequired(false);
          setLoadedId(id);
          setError("");
          setBusy(false);
          setSelectedRun(null);
          setEvidencePage(1);
          setRunPage(1);
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          if (lastLoadedId.current === id) {
            setSaveError(true);
            setRefreshRequired(true);
            setMessage(`Could not reload the candidate. Your drafts are kept. ${e instanceof Error ? e.message : "Try reloading again."}`);
            return;
          }
          setRecord(null);
          setLoadedId(id);
          setError(
            e instanceof Error ? e.message : "Could not load this resume.",
          );
        }
      }
    }
    void load();
    return () => {
      controller.abort();
      saveController.current?.abort();
    };
  }, [id, retry]);
  useEffect(() => {
    if (!editable || !evidenceOpen) return;
    const controller = new AbortController();
    async function load() {
      setEvidenceBusy(true);
      try {
        if (selectedRun) {
          const data = await requestJson<{ run: RunView }>(
            `/api/resumes/${id}/candidate/provenance?runId=${encodeURIComponent(selectedRun)}&page=${evidencePage}`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) setRunEvidence(data.run);
        } else {
          const data = await requestJson<{ runs: RunView[] }>(
            `/api/resumes/${id}/candidate/provenance?page=${runPage}`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) {
            setRuns(data.runs);
            setRunEvidence(null);
          }
        }
        if (!controller.signal.aborted) {
          setEvidenceError("");
          setEvidenceId(id);
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setEvidenceError(
            e instanceof Error ? e.message : "Could not load evidence.",
          );
      } finally {
        if (!controller.signal.aborted) setEvidenceBusy(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [
    id,
    editable,
    evidenceOpen,
    runPage,
    selectedRun,
    evidencePage,
    record?.candidate?.revision,
  ]);
  const patch: Patch = async (changes) => {
    if (!editable || !record || saving.current || refreshRequired) return false;
    const controller = new AbortController();
    saveController.current = controller;
    saving.current = true;
    setBusy(true);
    setMessage("");
    setSaveError(false);
    try {
      await requestJson(`/api/resumes/${id}/candidate`, {
        method: "PATCH",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: record.candidate?.revision ?? 0,
          ...changes,
        }),
      });
      try {
        const updated = await loadResume(id, controller.signal);
        if (!controller.signal.aborted && currentId.current === id) {
          setRecord(updated);
          setMessage(
            changes.completeReview
              ? "Review completed. Field verification is unchanged."
              : "Selected field saved and verified.",
          );
        }
      } catch {
        if (!controller.signal.aborted) {
          setRefreshRequired(true);
          setSaveError(true);
          setMessage(
            "The edit was saved, but the updated record could not load. Reload before making further changes.",
          );
        }
      }
      return true;
    } catch (e) {
      if (!controller.signal.aborted) {
        setSaveError(true);
        setMessage(
          e instanceof Error ? e.message : "Could not save the correction.",
        );
      }
      return false;
    } finally {
      saving.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  async function savePending() {
    try {
      const pending = [...drafts.current.values()];
      const changes = mergeReviewDrafts(pending.map((d) => d.build()));
      if (pending.length && (await patch(changes)))
        pending.forEach((d) => d.clear());
    } catch (e) {
      setSaveError(true);
      setMessage(
        e instanceof Error ? e.message : "Invalid pending correction.",
      );
    }
  }
  const loading = loadedId !== id;
  if (loading || !record)
    return (
      <main className="tool-page">
        <div className="tool-header">
          <div>
            <Link href="/resumes" className="back-link">
              ← All resumes
            </Link>
            <h1>Resume details</h1>
          </div>
        </div>
        <section
          className={`tool-panel table-state ${error ? "ui-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {loading
            ? "Loading resume…"
            : error || "No resume data is available."}
          {!loading && (
            <button
              className="button button-secondary"
              onClick={() => {
                setLoadedId("");
                setRetry((n) => n + 1);
              }}
            >
              Try again
            </button>
          )}
        </section>
      </main>
    );
  const b = record.extraction,
    p = record.candidate;
  const editor = (
    section: string,
    values: object,
    fields = recordFields[section],
  ) =>
    editable &&
    record.status !== "CANCELLED" && (
      <FieldEditor
        key={`${id}-${section}-${"id" in values ? String(values.id) : "skillId" in values ? String(values.skillId) : "profile"}-${fields[0].key}`}
        section={section}
        record={storedValues(values)}
        fields={fields}
        patch={patch}
        busy={busy || refreshRequired}
        onDraft={onDraft}
        token={
          verificationPrefix(section, values) + "|" + fields[0].key
        }
        manualFields={record.manualFields ?? []}
      />
    );
  const visibleRuns =
    evidenceId === id ? (runEvidence ? [runEvidence] : runs) : [];
  return (
    <VerificationContext.Provider value={record.manualFields ?? []}>
      <main className="tool-page candidate-review">
        <CandidateHeader record={record} editable={editable} downloadable={can("resumes.download")} busy={busy} refreshRequired={refreshRequired} draftCount={draftCount} save={() => void savePending()} complete={() => void patch({ completeReview: true })} reload={() => setRetry(n => n + 1)} />
        {message && (
          <p
            role={saveError ? "alert" : "status"}
            className={`review-notice ${saveError ? "ui-error" : "review-success"}`}
          >
            {message}
          </p>
        )}
        <div className="review-legend">
          <span>Machine extracted</span>
          <span className="is-verified">Manually verified fields</span>
          <span className="is-uncertain">Uncertain extraction</span>
          <span>Missing optional values are informational</span>
          {draftCount > 0 && (
            <strong role="status">
              {draftCount} unsaved correction{draftCount > 1 ? "s" : ""} · save
              before completing review
            </strong>
          )}
        </div>
        <label className="panel-proportion">
          Information panel width{" "}
          <input
            aria-label="Information panel width"
            type="range"
            min="40"
            max="70"
            value={panelWidth}
            onChange={(e) => setPanelWidth(Number(e.target.value))}
          />{" "}
          {panelWidth}%
        </label>
        <div
          className="candidate-workspace"
          style={{
            gridTemplateColumns:
              (can("resumes.download") ? panelWidth : 70) + "% minmax(0, 1fr)",
          }}
        >
          <div className="candidate-information">
            <ReviewNavigation />
            <div
              id="candidate-information-scroll"
              className="candidate-section-scroll"
              tabIndex={0}
              aria-label="Candidate information"
            >
              <section tabIndex={-1} id="overview" className="tool-panel">
                <h2>Identity and career profile</h2>
                <dl className="candidate-facts">
                  <Value
                    label="Full name"
                    value={b?.name}
                    path="basic.name"
                    confidence={b?.nameConfidence}
                  />
                  <Value
                    label="Email"
                    value={b?.email}
                    path="basic.email"
                    confidence={b?.emailConfidence}
                  />
                  <Value
                    label="Phone"
                    value={b?.phone}
                    path="basic.phone"
                    confidence={b?.phoneConfidence}
                  />
                  <Value
                    label="Designation"
                    value={b?.designation}
                    path="basic.designation"
                    confidence={b?.designationConfidence}
                  />
                  <Value
                    label="Location"
                    value={p?.locationText}
                  />
                  <Value
                    label="Date of birth"
                    value={p?.dateOfBirth?.slice(0, 10)}
                    path="profile.dateOfBirth"
                  />
                </dl>
                <ReviewMark verifiedAt={p?.verifiedAt} />
                <VerifiedFields prefix="basic" />
                {editor("basic", b ?? {}, identityFields)}
                {editor(
                  "profile",
                  p ?? {},
                  profileFields.filter(
                    (f) =>
                      ![
                        "headline",
                        "summary",
                        "objective",
                        "totalExperienceMonths",
                        "noticePeriod",
                        "employmentPreferences",
                      ].includes(f.key),
                  ),
                )}
                {!p && (
                  <Empty>
                    No structured candidate profile is stored yet. Legacy
                    contact data remains available above.
                  </Empty>
                )}
                <p className="candidate-muted">
                  {record.fileName} · Optional missing values do not block
                  review.
                </p>
              </section>
              <section tabIndex={-1} id="summary" className="tool-panel">
                <h2>Professional summary and preferences</h2>
                <dl className="candidate-facts">
                  <Value
                    label="Headline"
                    value={p?.headline}
                    path="profile.headline"
                  />
                  <Value
                    label="Experience"
                    value={experienceLabel(p?.totalExperienceMonths)}
                  />
                  <Value
                    label="Notice period"
                    value={p?.noticePeriod}
                    path="profile.noticePeriod"
                  />
                  <Value
                    label="Employment preferences"
                    value={p?.employmentPreferences.join(", ")}
                    path="profile.employmentPreferences"
                  />
                </dl>
                <h3>Professional summary</h3>
                <VerifiedFields prefix="profile" />
                {p?.summary ? (
                  <p className="candidate-prose">{p.summary}</p>
                ) : (
                  <Empty>No summary identified.</Empty>
                )}
                <h3>Career objective</h3>
                {p?.objective ? (
                  <p className="candidate-prose">{p.objective}</p>
                ) : (
                  <Empty>No career objective identified.</Empty>
                )}
                <p>
                  Basic identity/title confidence:{" "}
                  {b
                    ? `${Math.round(b.overallConfidence * 100)}%`
                    : "Not available"}
                  . {b?.requiresReview ? "Review required." : ""}
                  {" "}This score covers name, email, phone and designation; other sections need independent review.
                </p>
                {editor(
                  "profile",
                  p ?? {},
                  profileFields.filter((f) =>
                    [
                      "headline",
                      "summary",
                      "objective",
                      "totalExperienceMonths",
                      "noticePeriod",
                      "employmentPreferences",
                    ].includes(f.key),
                  ),
                )}
              </section>
              <section tabIndex={-1} id="employment" className="tool-panel">
                <h2>Employment history</h2>
                {p?.employment.length ? (
                  p.employment.map((j) => (
                    <article className="candidate-record" key={j.id}>
                      <h3>
                        {j.designation || "Role not identified"} ·{" "}
                        {j.employer || "Employer not identified"}
                      </h3>
                      <p>
                        {dateLabel(j, "start")} –{" "}
                        {j.isCurrent ? "Present" : dateLabel(j, "end")}
                        {j.location ? ` · ${j.location}` : ""}
                        {j.employmentType ? ` · ${j.employmentType}` : ""}
                      </p>
                      {j.description && (
                        <p className="candidate-prose">{j.description}</p>
                      )}
                      <Bullets
                        title="Responsibilities"
                        items={j.responsibilities}
                      />
                      <Bullets title="Achievements" items={j.achievements} />
                      <ReviewMark
                        verifiedAt={j.verifiedAt}
                        confidence={j.confidence}
                      />
                      <VerifiedFields prefix={`employment.${j.id}`} />
                      {editor("employment", j)}
                    </article>
                  ))
                ) : (
                  <Empty />
                )}
              </section>
              <section tabIndex={-1} id="education" className="tool-panel">
                <h2>Education</h2>
                {p?.education.length ? (
                  p.education.map((e) => (
                    <article className="candidate-record" key={e.id}>
                      <h3>
                        {e.degree || "Degree not identified"}
                        {e.fieldOfStudy ? ` · ${e.fieldOfStudy}` : ""}
                      </h3>
                      <p>
                        {e.institution || "Institution not identified"}
                        {e.location ? ` · ${e.location}` : ""}
                      </p>
                      <p>
                        {dateLabel(e, "start")} – {dateLabel(e, "end")}
                        {e.grade
                          ? ` · Grade: ${e.grade}${e.gradeScale ? ` / ${e.gradeScale}` : ""}`
                          : ""}
                      </p>
                      {e.description && <p>{e.description}</p>}
                      <ReviewMark
                        verifiedAt={e.verifiedAt}
                        confidence={e.confidence}
                      />
                      <VerifiedFields prefix={`education.${e.id}`} />
                      {editor("education", e)}
                    </article>
                  ))
                ) : (
                  <Empty />
                )}
              </section>
              <section tabIndex={-1} id="skills" className="tool-panel">
                <h2>Skills and categories</h2>
                {p?.skills.length ? (
                  <div className="candidate-skills">
                    {p.skills.map((s) => (
                      <article key={s.skillId}>
                        <h3 className="skill-chip">{s.skill.canonicalName}</h3>
                        <p>
                          {s.skill.category || "Uncategorized"}
                          {s.context ? ` · ${s.context}` : ""}
                        </p>
                        {(s.originalText || s.skill.terms.length > 0) && (
                          <details className="skill-source">
                            <summary>Source wording and aliases</summary>
                            <p>
                              {s.originalText || "Source wording not recorded"}
                            </p>
                            <p>
                              {s.skill.terms
                                .map((term) => term.displayName)
                                .join(", ")}
                            </p>
                          </details>
                        )}
                        <ReviewMark
                          verifiedAt={s.verifiedAt}
                          confidence={s.confidence}
                        />
                        {editor("skills", {
                          name: s.skill.canonicalName,
                          skillId: s.skillId,
                          context: s.context,
                          originalText: s.originalText,
                          confidence: s.confidence,
                          verifiedAt: s.verifiedAt,
                        })}
                      {editable && record.status !== "CANCELLED" && (
                          <button
                            disabled={busy || refreshRequired || draftCount > 0}
                            className="button button-secondary"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Remove ${s.skill.canonicalName} from this candidate?`,
                                )
                              )
                                void patch({ skills: { remove: [s.skillId] } });
                            }}
                          >
                            Remove skill
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <Empty />
                )}
                {editor("skills", {}, [
                  { key: "name", label: "New skill name" },
                ])}
              </section>
              <section tabIndex={-1} id="projects" className="tool-panel">
                <h2>Projects and technologies</h2>
                {p?.projects.length ? (
                  p.projects.map((j) => (
                    <article className="candidate-record" key={j.id}>
                      <h3>{j.name || "Project name not identified"}</h3>
                      <p>
                        {j.role || "Role not identified"} ·{" "}
                        {dateLabel(j, "start")} – {dateLabel(j, "end")}
                      </p>
                      {j.description && (
                        <p className="candidate-prose">{j.description}</p>
                      )}
                      <p>
                        Technologies:{" "}
                        {j.skills
                          .map((s) => s.skill.canonicalName)
                          .join(", ") || "Not identified"}
                      </p>
                      {j.url && <External url={j.url} />}
                      <Bullets
                        title="Responsibilities"
                        items={j.responsibilities}
                      />
                      <Bullets title="Achievements" items={j.achievements} />
                      <ReviewMark
                        verifiedAt={j.verifiedAt}
                        confidence={j.confidence}
                      />
                      <VerifiedFields prefix={`projects.${j.id}`} />
                      {editor("projects", {
                        ...j,
                        skills: j.skills.map((s) => s.skill.canonicalName),
                      })}
                    </article>
                  ))
                ) : (
                  <Empty />
                )}
              </section>
              <section tabIndex={-1} id="certifications" className="tool-panel">
                <h2>Certifications</h2>
                {p?.certifications.length ? (
                  p.certifications.map((c) => (
                    <article className="candidate-record" key={c.id}>
                      <h3>{c.name || "Certification name not identified"}</h3>
                      <p>
                        {c.issuer || "Issuer not identified"} ·{" "}
                        {c.credentialId || "Credential ID not identified"}
                      </p>
                      <p>
                        Issued: {dateLabel(c, "issue")} · Expiry:{" "}
                        {dateLabel(c, "expiry")}
                      </p>
                      {c.url && <External url={c.url} />}
                      <ReviewMark
                        verifiedAt={c.verifiedAt}
                        confidence={c.confidence}
                      />
                      <VerifiedFields prefix={`certifications.${c.id}`} />
                      {editor("certifications", c)}
                    </article>
                  ))
                ) : (
                  <Empty />
                )}
              </section>
              <section tabIndex={-1} id="links" className="tool-panel">
                <h2>Professional links</h2>
                {p?.links.length ? (
                  p.links.map((l) => (
                    <article className="candidate-record" key={l.id}>
                      <External url={l.url} label={l.label} />
                      <p>{l.type}</p>
                      <ReviewMark verifiedAt={l.verifiedAt} />
                      <VerifiedFields prefix={`links.${l.id}`} />
                      {editor("links", l)}
                    </article>
                  ))
                ) : (
                  <Empty />
                )}
              </section>
              <section tabIndex={-1} id="additional" className="tool-panel">
                <h2>Languages, awards and additional qualifications</h2>
                {p?.additional.length ? (
                  p.additional.map((a) => (
                    <article className="candidate-record" key={a.id}>
                      <h3>{a.title || "Title not identified"}</h3>
                      <p>{a.type}</p>
                      {a.details &&
                        typeof a.details === "object" &&
                        !Array.isArray(a.details) && (
                          <dl className="candidate-facts">
                            {Object.entries(a.details).map(([key, v]) => (
                              <Value
                                key={key}
                                label={key}
                                value={
                                  v == null
                                    ? null
                                    : typeof v === "object"
                                      ? JSON.stringify(v)
                                      : String(v)
                                }
                              />
                            ))}
                          </dl>
                        )}
                      <ReviewMark
                        verifiedAt={a.verifiedAt}
                        confidence={a.confidence}
                      />
                      <VerifiedFields prefix={`additional.${a.id}`} />
                      {editor("additional", a)}
                    </article>
                  ))
                ) : (
                  <Empty />
                )}
              </section>
              <section tabIndex={-1} id="source" className="tool-panel">
                <h2>Original document and extraction provenance</h2>
                <p>Private original file · {record.fileType.toUpperCase()}</p>
                {can("resumes.download") ? (
                  <a
                    className="button button-secondary"
                    href={`/api/resumes/${id}/file`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open original resume
                  </a>
                ) : (
                  <Empty>
                    Document download permission is required to open the
                    original.
                  </Empty>
                )}
                {editable ? (
                  <details
                    onToggle={(e) => setEvidenceOpen(e.currentTarget.open)}
                  >
                    <summary>Extraction runs and source evidence</summary>
                    {evidenceBusy && <p role="status">Loading evidence…</p>}
                    {evidenceError && (
                      <p role="alert" className="ui-error">
                        {evidenceError}
                      </p>
                    )}
                    {!evidenceBusy && !evidenceError && !visibleRuns.length && (
                      <Empty>No extraction provenance is available.</Empty>
                    )}
                    {!evidenceBusy &&
                      !evidenceError &&
                      visibleRuns.map((run) => (
                        <article className="candidate-record" key={run.id}>
                          <h3>
                            {run.method} ·{" "}
                            {run.parserVersion || "Manual / legacy run"}
                          </h3>
                          <p>
                            {new Date(run.startedAt).toLocaleString()} ·{" "}
                            {run._count.evidence} evidence records
                          </p>
                          <div className="table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>Field</th>
                                  <th>Source / location</th>
                                  <th>Evidence</th>
                                  <th>Verification</th>
                                </tr>
                              </thead>
                              <tbody>
                                {run.evidence.map((e) => (
                                  <tr key={e.id}>
                                    <td>{e.fieldPath}</td>
                                    <td>
                                      {e.sourceSection || "Not recorded"}
                                      <br />
                                      {e.location
                                        ? JSON.stringify(e.location)
                                        : ""}
                                    </td>
                                    <td>
                                      {e.text || "Manual verification event"}
                                    </td>
                                    <td>
                                      {e.verifiedAt
                                        ? "Submitted field / record manually reviewed"
                                        : e.confidence == null
                                          ? "Not scored"
                                          : `Machine ${Math.round(e.confidence * 100)}%`}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {!selectedRun && run._count.evidence > 100 && (
                            <button
                              className="button button-secondary"
                              onClick={() => {
                                setSelectedRun(run.id);
                                setEvidencePage(1);
                              }}
                            >
                              Browse all evidence for this run
                            </button>
                          )}
                        </article>
                      ))}
                    <div className="candidate-actions">
                      {selectedRun ? (
                        <>
                          <button
                            disabled={evidenceBusy || evidencePage === 1}
                            onClick={() => setEvidencePage((n) => n - 1)}
                          >
                            Previous evidence
                          </button>
                          <span>Page {evidencePage}</span>
                          <button
                            disabled={
                              evidenceBusy ||
                              !runEvidence ||
                              evidencePage * 100 >= runEvidence._count.evidence
                            }
                            onClick={() => setEvidencePage((n) => n + 1)}
                          >
                            Next evidence
                          </button>
                          <button
                            onClick={() => {
                              setSelectedRun(null);
                              setEvidencePage(1);
                            }}
                          >
                            Back to runs
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            disabled={evidenceBusy || runPage === 1}
                            onClick={() => setRunPage((n) => n - 1)}
                          >
                            Previous runs
                          </button>
                          <span>Page {runPage}</span>
                          <button
                            disabled={evidenceBusy || runs.length < 25}
                            onClick={() => setRunPage((n) => n + 1)}
                          >
                            Next runs
                          </button>
                        </>
                      )}
                    </div>
                  </details>
                ) : (
                  <Empty>
                    Source evidence is available to authorized reviewers.
                  </Empty>
                )}
              </section>
              <section className="tool-panel">
                <h2>Review actions</h2>
                <p>
                  Saving a correction verifies only the submitted field.
                  Completing review changes the workflow status without claiming
                  all fields were individually verified.
                </p>
                <p className="candidate-muted">
                  {editable
                    ? "Use the header actions to save corrections and complete review. Reload fetches the latest revision and keeps open field drafts."
                    : "Edit permission is required to submit corrections."}
                </p>
              </section>
            </div>
          </div>
          <PdfPreview
            key={id}
            id={id}
            fileType={record.fileType}
            allowed={can("resumes.download")}
          />
        </div>
      </main>
    </VerificationContext.Provider>
  );
}
