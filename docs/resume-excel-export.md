# Approved resume Excel export

The current export contains exactly **one worksheet, Resumes**, with exactly **21 columns** and one data row per selected Resume ID. This replaces the earlier 50-column, multi-sheet presentation described in the architecture audit. Export reads persisted extraction/candidate records; it does not parse documents or modify candidate data.

## Exact columns and database mappings

Column definitions: `lib/excel-export.ts`, `resumeExportColumns`. Mapping: `mapStoredResume`. Retrieval: `resumeExportInclude`, reusing the same `candidateInclude` as Resume Details. `app/api/export/route.ts` still pages Resume parents in batches of 500, ordered by ID.

| # | Exact column name | Authoritative database source |
| ---: | --- | --- |
| 1 | CV ID | Resume.id |
| 2 | File Name | Resume.fileName |
| 3 | Name | ResumeExtraction.name |
| 4 | Email | ResumeExtraction.email |
| 5 | Phone | ResumeExtraction.phone |
| 6 | Designation | ResumeExtraction.designation |
| 7 | Location | CandidateProfile.locationText, with no fallback/inference |
| 8 | Headline | CandidateProfile.headline |
| 9 | Summary | CandidateProfile.summary |
| 10 | Total Experience (Months) | CandidateProfile.totalExperienceMonths; stored zero stays zero |
| 11 | Employment History | All CandidateEmployment rows: employer, designation, start/end dates and original date text, isCurrent, location, employmentType, description, responsibilities, achievements |
| 12 | Highest Qualification | Existing highestEducation helper (`lib/resume-overview.ts`) applied to stored CandidateEducation; exports selected degree, without changing the application's degree-rank/latest-end-year rule |
| 13 | Education | All CandidateEducation rows: degree, institution, fieldOfStudy, start/end dates and original date text, location, grade, gradeScale, description |
| 14 | Skills | All ResumeSkill/Skill associations: canonicalName, category, SkillTerm display names, originalText, context; no top-five cap |
| 15 | Projects | All CandidateProject rows: name, description, role, start/end dates and original date text, url, responsibilities, achievements; all associated ProjectSkill/Skill technologies with canonical name/category |
| 16 | Certifications | All CandidateCertification rows: name, issuer, credentialId, issue/expiry dates and original date text, url |
| 17 | Links | All CandidateLink rows: type, url, label |
| 18 | Additional Information | All CandidateAdditional rows: type, title, complete stored details JSON |
| 19 | Status | Resume.status |
| 20 | Overall Confidence | ResumeExtraction.overallConfidence × 100, rounded to integer as before; numeric value 93 displays as 93%; absent extraction retains the existing zero behavior |
| 21 | Created At | Resume.createdAt in UTC ISO 8601 format |

Current manual corrections take precedence because export reads current persisted records rather than parser evidence/history. Cleared basic fields remain blank even when headline values exist. Missing optional scalar fields, absent candidate profiles and empty relations remain blank. Missing experience is never converted into zero/Fresher. The finalized format intentionally excludes the retired profile/contact columns, child technical IDs/positions/confidences/verification metadata and standalone per-field confidence columns; the retained internal fields remain in the database. M3.5 removes only the eight approved split-name, secondary-contact and geographic-component columns; historical evidence and audit history remain intact.

## Multi-record cell format

Employment, education, skills, projects, certifications, links and additional information use numbered entries separated by a blank line, with labeled attributes on separate lines. Missing attributes are omitted within an entry; the associated record itself is retained. Ordering is position then ID for ordered child tables, skillId for skills/project technologies, ID for links, and normalizedName for skill terms. Sorting uses copies and does not mutate source arrays.

Example with synthetic values:

```text
1. Employer: Example Company
   Designation: Example Role
   Start Date: 2020
   End Date: 2022-06 (original: June 2022)
   Description: Stored description

2. Employer: Another Company
   Designation: Another Role
```

Partial dates retain their existing precision. Where stored original date text differs from the numeric representation, both are shown; current employment is represented only by its stored Current attribute, with no invented end date. Arrays and nested JSON are indented and serialized with recursively sorted object keys; array order, explicit null/zero/false, embedded delimiters and nested details are preserved. Primary Location is never synthesized from unrelated fields.

## Formatting, safety and limits

The purple bold header remains. Resume ID/File Name and the header are frozen; autofilter covers A1:U1. Columns have readable widths with top alignment and text wrapping. All candidate content is serialized as primitive string values, never formula or hyperlink objects; formula-like input stays text. Created At stays ISO UTC; Overall Confidence keeps its existing integer-percentage meaning with a percent display suffix.

Excel cells cannot hold more than **32,767 UTF-16 code units** under the export's conservative length check. If any approved cell exceeds that limit after serialization, generation throws an explicit column/length error and the download stream fails. It does **not** truncate, omit entries, create extra columns, split resumes into multiple rows, or add worksheets. Because this remains a streaming endpoint, an error after headers have been sent can appear as an interrupted download rather than a JSON error response. A successful download is never substituted with a shortened version of the oversized value.

Without Value States, blank cells no longer independently distinguish database NULL from an explicitly blank string. This is an intentional consequence of the finalized presentation; source values remain unchanged. The existing paginated endpoint does not hold a transaction-wide snapshot across concurrent edits. For large multi-line records, Excel's row-height display can require expanding/viewing the cell to read all text; the stored cell content is retained.

Filters, authorization (`resumes.export`), actor validation, ALL/COMPLETED/REVIEW/FAILED/DUPLICATE/CANCELLED/REVIEWED semantics, 500-parent cursor pagination, download headers, no-store caching and the existing export.completed audit entry remain unchanged. No export-page redesign was made. REVIEW records are not excluded for missing fields.

## Validation

Synthetic tests check the exact worksheet name/count, all 24 headers/order/mappings, missing fields, REVIEW/COMPLETED, current manual values and explicit clears, all multiple child entries, deterministic serialization, source immutability, format styles, original overall-confidence semantics, formula-like input, exact cell-size boundary, overflow failure, status filters, permissions and 501-row pagination.

Validation results:

- The relevant seven-file serial Vitest run passed all 74 tests present at that point (26 export tests and 48 existing regression tests). After adding the explicit multiple-project/certification/link/additional-record case, the final focused run passed all **27 export tests**. All **75 distinct relevant tests** passed across these runs, with no failures or skips.
- `npx tsc --noEmit`: passed.
- `npx eslint lib/excel-export.ts app/api/export/route.ts tests/excel-export.test.ts tests/resume-parser.test.ts`: passed.
- `npx next build`: passed production compilation, TypeScript and generation of all 34 static pages. The existing ancestor-lockfile/workspace-root warning remains; no unrelated environment/configuration change was made.
- `git diff --check`: passed.

Read-only verification against the existing database generated and loaded the workbook in memory: **20 selected processed resumes (19 REVIEW, 1 COMPLETED), 20 data rows, 20 distinct Resume IDs, exactly 21 columns, exactly one Resumes worksheet, all 480 cells matching the mapped persisted values**. Largest serialized cell: **4,362 code units**, within the limit. The database connection enforced default_transaction_read_only; no workbook containing candidate data was saved to disk. The temporary verifier was removed.

Files changed: `lib/excel-export.ts`, `app/api/export/route.ts`, `tests/excel-export.test.ts`, the existing export assertion in `tests/resume-parser.test.ts`, this document and a historical-format notice in `docs/resume-processing-export-audit.md`. Parser algorithms, worker/queue/retry behavior, database/schema/records and review policies were not modified. No AI calls, migrations, reprocessing, commits or pushes were performed.
