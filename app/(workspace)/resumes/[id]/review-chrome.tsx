"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import StatusBadge from "../../status-badge";
import type { ResumeView } from "@/lib/resume-review";

const groups = [
  { id: "overview", label: "Overview", sections: ["overview", "summary"] },
  { id: "employment", label: "Experience", sections: ["employment"] },
  { id: "education", label: "Education", sections: ["education"] },
  { id: "skills", label: "Skills & Projects", sections: ["skills", "projects"] },
  { id: "certifications", label: "Credentials & More", sections: ["certifications", "links", "additional"] },
  { id: "source", label: "Evidence", sections: ["source"] },
];

export function ReviewNavigation() {
  const [active, setActive] = useState("overview");
  useEffect(() => {
    const panel = document.getElementById("candidate-information-scroll");
    if (!panel) return;
    let frame = 0;
    const update = () => {
      const top = panel.getBoundingClientRect().top + 48;
      let current = "overview";
      let nearest = -Infinity;
      for (const group of groups) {
        for (const id of group.sections) {
          const section = document.getElementById(id);
          const position = section?.getBoundingClientRect().top;
          if (position !== undefined && position <= top && position > nearest) {
            nearest = position;
            current = group.id;
          }
        }
      }
      if (panel.scrollTop > 0 && panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 3) current = "source";
      setActive(current);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    resize.observe(panel);
    panel.querySelectorAll("section").forEach(section => resize.observe(section));
    panel.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); panel.removeEventListener("scroll", schedule); };
  }, []);
  return <nav className="candidate-section-links" aria-label="Candidate sections">
    {groups.map(group => <a key={group.id} href={"#" + group.id} aria-current={active === group.id ? "location" : undefined} onClick={event => {
      event.preventDefault();
      const panel = document.getElementById("candidate-information-scroll");
      const target = document.getElementById(group.id);
      if (panel && target) {
        panel.scrollTo({ top: panel.scrollTop + target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 20 });
        target.focus({ preventScroll: true });
        setActive(group.id);
      }
    }}>{group.label}</a>)}
  </nav>;
}

export function CandidateHeader({ record, editable, downloadable, busy, refreshRequired, draftCount, save, complete, reload }: {
  record: ResumeView; editable: boolean; downloadable: boolean; busy: boolean; refreshRequired: boolean; draftCount: number;
  save: () => void; complete: () => void; reload: () => void;
}) {
  const basic = record.extraction, profile = record.candidate;
  const name = basic?.name || "Candidate identity needs review";
  const location = profile?.locationText || "Location not identified";
  return <header className="tool-header candidate-sticky-header">
    <div className="candidate-identity">
      <Link href="/resumes" className="back-link">← All resumes</Link>
      <h1>{name}</h1>
      <p className="candidate-role"><strong>{basic?.designation || profile?.headline || "Designation not identified"}</strong><span>{location}</span></p>
      <div className="candidate-contact-line">
        {basic?.email ? <a href={"mailto:" + basic.email}>{basic.email}</a> : <span>Email not identified</span>}
        {basic?.phone ? <a href={"tel:" + basic.phone.replace(/\s/g, "")}>{basic.phone}</a> : <span>Phone not identified</span>}
      </div>
      <div className="candidate-header-meta"><StatusBadge status={record.status} /><span title="Average confidence for name, email, phone and current designation. It does not measure employment, education, skills or extraction completeness.">Basic identity/title confidence <strong>{basic ? Math.round(basic.overallConfidence * 100) + "%" : "unavailable"}</strong></span></div>
    </div>
    <div className="candidate-header-actions">
      <div className="candidate-source-actions">{downloadable && <a className="button button-secondary" href={"/api/resumes/" + encodeURIComponent(record.id) + "/file"} target="_blank" rel="noopener noreferrer">View original {record.fileType.toUpperCase()}</a>}<button className="button button-secondary" disabled={busy} onClick={reload}>Reload candidate</button></div>
      <div className="candidate-review-actions">{editable && record.status !== "CANCELLED" && <button className="button button-secondary" disabled={busy || refreshRequired || !draftCount} onClick={save}>Save pending corrections{draftCount ? " (" + draftCount + ")" : ""}</button>}{editable && ["REVIEW", "COMPLETED", "DUPLICATE"].includes(record.status) && <button className="button button-primary" disabled={busy || refreshRequired || draftCount > 0} onClick={complete}>{busy ? "Saving…" : "Complete review"}</button>}</div>
    </div>
  </header>;
}
