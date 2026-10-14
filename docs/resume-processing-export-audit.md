> M3.5 update: this audit records the earlier schema and export. The current export has 21 columns; the eight approved split-name, secondary-contact and geographic-component columns were retired. See `resume-excel-export.md` and `M3.5-candidate-cleanup.md` for the current contract and recovery procedure. Historical findings below are retained.

# Resume processing and Excel export audit

> Historical audit: its 50-column, multi-sheet export description has been superseded by the approved [single-sheet, 24-column format](resume-excel-export.md). The architecture findings and read-only completeness statistics below remain the original audit record; use the linked document for current export mappings and validation.

Audit date: 14 October 2026. This report describes the current working tree, including the owner's pre-existing uncommitted M3/review changes. Only the export implementation, focused export tests and this report were changed for this request. No commit, push, resume reprocessing, AI call, migration or candidate-data mutation was performed.

## A. Architecture

### Actual execution path

| Stage and responsible code | Runtime input → output | Database operations and connection to next stage | Information-loss risks / limits |
| --- | --- | --- | --- |
| Upload: `app/api/resumes/upload/route.ts:39`, `POST` | Authorized multipart files and batch settings → validated bytes, hash, accepted Resume IDs | Creates/reads `ProcessingBatch`; creates `Resume`; optionally creates `Duplicate`; reconciles batch counters | Unsupported signatures, empty/oversized files are rejected explicitly. File names are sanitized. Exact file-hash duplicates are saved as DUPLICATE and deliberately bypass processing. |
| Original file storage: `app/api/resumes/upload/route.ts:136` | Validated bytes → private UUID-named filesystem file | `Resume.filePath`, `fileHash`, `fileSize`, `fileType`, `fileName` identify the original file; `tx.resume.create` at line 149 creates its independent ID | Bytes are stored before the database transaction; failed transactions unlink the new file. A process crash between these operations could leave an orphan file. The database stores file metadata, not file bytes. |
| Queue: `lib/processing-queue.ts:8`, `scheduleResume`; line 54, `reconcileQueue`; `lib/queue-client.ts:10`, `getResumeQueue` | Resume ID + processing generation → BullMQ job | Reads/leases PENDING `Resume`; its persisted status acts as the durable outbox. Job ID includes generation. Reconciliation recovers expired claims and reschedules pending work | Redis outages defer scheduling rather than silently erase accepted Resume records. Retry/recovery settings were left unchanged. |
| Worker entry: `apps/worker/src/index.ts:18`; coordinator `lib/resume-worker.ts:17`, `runResumeJob` | Job `{resumeId,generation}` → owned processing attempt | `claimResume` (`lib/processing.ts:89`) reads/updates the original Resume; claim token/lease fence ownership. Worker checks original-file hash, renews lease, then invokes document reader | Unsupported format, missing/corrupt file, hash mismatch, decoding/timeout/limit failures become processing failures. Losing ownership prevents final writes. |
| Reader/OCR: `lib/resume-parser/document-reader.ts:62`, `LocalResumeParser.extractText`; `lib/resume-parser/pdf-layout.ts:5`, `readPdfLayout` | Original file path → text, OCR/page counts, warnings, duration | No candidate database writes. Worker passes text and reader warnings to structured extraction | PDF.js reads positioned text; deficient PDF pages use pdf-parse raster rendering and local Tesseract OCR. Images use local OCR. DOCX uses Mammoth HTML/text conversion; embedded DOCX images are **not OCR'd** (warning at reader line 159). Reading order, rotation, OCR quality, size/page/time/text limits can affect coverage. No second structured engine is introduced by these readers. |
| Local extraction: `lib/resume-parser/index.ts:24`, `extractStructuredResume` | Text + document warnings → `{basic,candidate,evidence,warnings,parserVersion,durationMs}` | No database writes. Normalization → section detection → identity/contact, professional, skills, records and links modules. Worker passes the entire result into finalization (`lib/resume-worker.ts:77`) | Schema validation can omit an invalid profile or entry; combined budget is 100 structured operations / 200 skill terms, with warnings (`index.ts:95–156`). Extractor-specific section/length/count caps and section classification can omit information. Evidence is capped at 1,500 entries; it is provenance, not the export's data source. |
| Persistence: `lib/processing.ts:142`, `finalizeResume`; `lib/resume-parser/persistence.ts:89`, `persistStructured` | Original Resume ID, ownership token, basic and complete structured result → persisted authoritative records | Serializable fenced transaction writes basic extraction, status, duplicate metadata, extraction run, candidate profile/children, evidence and batch counters. Structured persistence is called at processing line 247 | An existing CandidateProfile suppresses all subsequent machine replacement/first-fill of structured data (`persistence.ts:99–104`), preserving human edits/deletions. Later results become observed evidence. This also means an existing sparse profile is not automatically enriched. Transaction errors roll back the transaction; no independent structured write outside finalization was found. |
| Details / Review Queue: `app/api/resumes/[id]/route.ts:15`; `lib/candidate-data.ts:52`, `readCandidate`; `app/(workspace)/review/page.tsx:7`; `app/api/resumes/route.ts:24` | Authorized Resume ID or filtered paginated list → current persisted candidate/basic values | Details includes `candidateInclude` (`lib/candidate-data.ts:23`) without child-record limits. Review Queue uses the same list endpoint filtered by REVIEW. List reads `resumeOverviewSelect` | List is intentionally condensed: five skills and summarized education (`lib/resume-overview.ts:31`, `:73`). The Details client has explicit empty states and reads persisted sections (`app/(workspace)/resumes/[id]/client.tsx:452`, `:491`, `:527`, `:562`, `:593`). This is not evidence that the reader/parser captured all original document content. |
| Excel: `app/api/export/route.ts:12`; `lib/excel-export.ts:7`, `:63`, `:156` | Export permission + existing status filter → streamed XLSX | Pages original Resume records by ID, includes current extraction and candidate relations, writes one main row per Resume and separate child sheets | Previously fetched only basic extraction and defined 13 columns. The new projection includes the persisted structured relations; it never executes extraction. Concurrent edits between export pages can produce a workbook reflecting different read times; the existing endpoint does not hold a database-wide snapshot. |

### Parser inventory and milestone meanings

- **One active local structured pipeline.** `lib/resume-parser/index.ts:24` orchestrates extraction; its current version is `local-comprehensive-v1.1` (line 15). `LocalResumeParser` is the document reader, not a competing structured extractor.
- **Basic extraction component:** `lib/resume-parser/basic.ts:105`, `extractResumeFields`, implements reusable basic-field heuristics. Identity/contact, professional and record modules call it on relevant text subsets. These are helper calls within the same structured pipeline, not independent resume-processing jobs. Identity extraction's basic designation is deliberately replaced by the professional module's designation when assembling the structured result (`index.ts:75`). The worker recomputes the same four-field confidence average; it does not overwrite structured candidate sections.
- **Inactive AI implementation:** `ConfiguredAIParser` (`lib/resume-parser/basic.ts:272`) is a real configurable HTTP adapter for name/designation. It requires `AI_PARSING_ENABLED=true` plus provider/key/endpoint, but **the worker does not instantiate or invoke it**, even if those settings are present. The current production path has no local-to-AI fallback. Existing tests exercise the disabled adapter; it remains prepared for future use.
- `lib/resume-parser.ts:1` is a compatibility re-export facade, not another parser implementation. `evaluation.ts` and `scripts/evaluate-*` are offline evaluation callers, not worker paths. No other active or legacy standalone structured engine was found in the repository-wide reference search.
- At engine/strategy level there are two implementations: active local structured extraction and inactive remote AI adapter. At module level there is also the reusable basic heuristic implementation and multiple document-format readers. Counting those as competing engines would misrepresent the execution path.
- M1, M2 and M3 are **milestones**, not three engines: worker reliability (`docs/M1-worker-reliability.md:1`), candidate persistence foundation (`docs/M2-candidate-data.md:1`), comprehensive local extraction (`docs/M3-comprehensive-extraction.md:1`). M3.1–M3.3 cover evaluation/review/UI evolution.
- Similar date-flattening and skill-resolution helpers exist in the machine persistence and human-edit services (`lib/resume-parser/persistence.ts:8`, `:41`; `lib/candidate-data.ts:116`, `:140`). They serve different write boundaries/policies; they do not parse a resume twice. Additional emails intentionally exist in both basic extraction and profile data (`identity-contact.ts:201`); human edits can update them independently. Export retains both sources explicitly.

## B. Database and single source of truth

`prisma/schema.prisma` is the authority. `Resume.id` is a generated cuid primary key (line 60); original file paths are unique. `ResumeExtraction.resumeId` is unique and references Resume (line 94). `CandidateProfile.resumeId` is both primary key and foreign key to Resume (line 209).

Employment, education, projects, certifications, links, additional records and ResumeSkill all reference **CandidateProfile.resumeId**, preserving association with the original uploaded Resume ID. `ResumeSkill` has a composite `(resumeId,skillId)` key; projects link to Skill through `ProjectSkill`. Skill/SkillTerm provide the shared canonical-name/alias namespace. Ordered child tables have unique `(resumeId,position)` constraints. Schema anchors: `ResumeSkill:263`, `CandidateEmployment:276`, `CandidateEducation:305`, `CandidateProject:331`, `ProjectSkill:356`, `CandidateCertification:365`, `CandidateLink:387`, `CandidateAdditional:399`.

`ExtractionRun` references Resume (`schema.prisma:412`); `CandidateEvidence` references its run (`:426`). These contain provenance and human verification references, not an alternative authoritative candidate profile. Evidence remains subject to the existing edit permission and is not added to the export. `Resume.duplicateOf` and `Duplicate.resumeId` are scalar IDs without a declared FK; `Duplicate.originalResumeId` has the actual Resume relation. Export does not borrow candidate data from the duplicate's original ID.

Five migrations were confirmed applied through read-only queries: init, add_user, hybrid_rbac, processing_reliability and candidate_data. The structured migration creates the normalized tables and FKs (`prisma/migrations/20261013020000_candidate_data/migration.sql:11`, `:285`). Generated Prisma reads of every export relation succeeded, with no schema/client/column mismatch encountered.

The database is the single source for Details, Review Queue and the updated export. Machine writes go through fenced `finalizeResume`/`persistStructured`. Current manual edits go through `patchCandidate` (`lib/candidate-data.ts:229`); legacy basic reviews use `saveReview` (`lib/processing.ts:448`). Basic manual edits set the replacement fence (`candidate-data.ts:325`), and structured corrections use optimistic revision checks. Export reads those current records, never prior run evidence or an in-memory parser cache.

Confirmed limitations are the existing profile first-fill policy, independent mirrored contact fields and exact-file duplicates bypassing extraction. None prevents reliably exporting the stored records. No data-model change or architecture workaround was necessary.

## C. Existing resumes: actual read-only verification

Two checks were completed: PostgreSQL transactions using `BEGIN READ ONLY`, and Prisma retrieval/workbook generation with connection-level `default_transaction_read_only=on`. No source documents were reparsed. No candidate names, contacts, IDs, document snippets or file paths are included in this report.

- Total Resume records inspected: **20**.
- Status counts: REVIEW **19**, COMPLETED **1**; DUPLICATE/PENDING/PROCESSING/FAILED/CANCELLED **0**.
- Eligible processed resumes examined: **20**. All have both ResumeExtraction and CandidateProfile.
- Candidate service retrieval matched export data for **20/20** using `readCandidate`, including summary/designation and employment/education/skill counts. The actual authenticated HTTP API and browser were not exercised against these records; endpoint retrieval was verified in code and mocked route tests.
- Persisted runs: 20 LOCAL `local-comprehensive-v1` runs and 1 HUMAN run. Current code is v1.1; existing records were **not** refreshed.

| Stored field | Non-empty resumes | NULL / absent | Empty stored arrays / strings |
| --- | ---: | ---: | ---: |
| Name | 19 | 1 | 0 |
| Email | 20 | 0 | 0 |
| Phone | 20 | 0 | 0 |
| Designation | 11 | 9 | 0 |
| First name | 18 | 2 | 0 |
| Last name | 18 | 2 | 0 |
| Profile additional emails | 0 | 0 | 20 |
| Profile additional phones | 0 | 0 | 20 |
| Location text | 0 | 20 | 0 |
| City | 0 | 20 | 0 |
| State / region | 0 | 20 | 0 |
| Country | 0 | 20 | 0 |
| Date of birth | 0 | 20 | 0 |
| Headline | 9 | 11 | 0 |
| Summary | 16 | 4 | 0 |
| Objective | 0 | 20 | 0 |
| Total experience months | 1 | 19 | 0 |
| Notice period | 0 | 20 | 0 |
| Employment preferences | 0 | 0 | 20 |

| Relation | Resumes with records | Resumes without records | Total child records |
| --- | ---: | ---: | ---: |
| Employment | 6 | 14 | 9 |
| Education | 17 | 3 | 21 |
| Skills | 16 | 4 | 36 |
| Projects | 17 | 3 | 17 |
| Certifications | 17 | 3 | 76 |
| Links | 0 | 20 | 0 |
| Additional information | 20 | 0 | 73 |
| Additional records typed QUALIFICATION | 0 | 20 | 0 |

Highest Qualification is derived from stored education using the existing UI ranking. Top Skills is the existing five-skill view derived from stored confidence; neither is a separate persisted field. Degrees can be present even when the separate QUALIFICATION additional type has no records.

REVIEW retains stored data: its 19 records include 18 names, 10 designations, 15 summaries, 1 total-experience value, employment on 6, education on 16 and skills on 15. The one COMPLETED record has name/designation/summary/education/skills, with no location or total-experience value. Export has no exclusion based on field completeness.

Persisted warning-code counts: `LAYOUT_READING_ORDER_UNCERTAIN` on 18 runs; `UNRESOLVED_EMPLOYMENT` on 17; `MISSING_CANDIDATE_NAME` on 1. These are confirmed historical warnings, not proof of the exact document-reading or extraction failure for each field. No `INVALID_*`, `STRUCTURED_OUTPUT_TRUNCATED` or `STRUCTURED_VALIDATION_FAILED` code appeared in those stored document-warning entries.

**Root-cause assessment:** the old export projection/columns definitively omitted stored structured data. Location/designation/experience gaps definitively already exist in persistence. No retrieval failure was observed with the current generated client and candidate service. An OCR failure, specific parser heuristic failure, old-version mapping failure or historical persistence failure cannot be assigned to every blank field without comparing original documents and historical output; that comparison was deliberately not performed. First-fill prevents automatically applying v1.1 improvements to these v1 records, but is not evidence that it caused their initial omissions. UI lists intentionally summarize data; no live-browser rendering failure was established.

## D. Excel export update and exact mappings

Original columns remain in order and meaning: CV ID, File Name, Name, Email, Phone, Designation, Name Confidence, Email Confidence, Phone Confidence, Designation Confidence, Overall Confidence, Status, Created At. Basic values are from ResumeExtraction; confidence values remain rounded percentages; ID/file/status/date come from Resume. Missing confidence remains the original zero behavior, while missing experience stays blank.

The main Resumes sheet now has **50 columns**. The 37 added columns are mapped below. Implementation anchors: query `lib/excel-export.ts:7`, definitions `:32`, mapping `:63`, detail definitions `:36`, writer `:156`. Details API exposes the same extraction/profile/relations at `app/api/resumes/[id]/route.ts:24`.

| Added column | Parser output property → persistence / database source → Details API property |
| --- | --- |
| Other Emails | `basic.otherEmails` → `finalizeResume` → `ResumeExtraction.otherEmails` → `extraction.otherEmails` |
| Phone Country Code | `basic.countryCode` → `finalizeResume` → `ResumeExtraction.countryCode` → `extraction.countryCode` |
| Normalized Phone | `basic.normalizedPhone` → `finalizeResume` → `ResumeExtraction.normalizedPhone` → `extraction.normalizedPhone` |
| First Name | `candidate.profile.firstName` → `persistStructured` → `CandidateProfile.firstName` → `candidate.firstName` |
| Last Name | `candidate.profile.lastName` → same profile persistence → `CandidateProfile.lastName` → `candidate.lastName` |
| Additional Emails | `candidate.profile.additionalEmails` → same → `CandidateProfile.additionalEmails` → `candidate.additionalEmails` |
| Additional Phones | `candidate.profile.additionalPhones` (validated/normalized phone objects) → same → `CandidateProfile.additionalPhones` JSON → `candidate.additionalPhones` |
| City | `candidate.profile.city` → same → `CandidateProfile.city` → `candidate.city` |
| State / Region | `candidate.profile.region` → same → `CandidateProfile.region` → `candidate.region` |
| Country | `candidate.profile.country` → same → `CandidateProfile.country` → `candidate.country` |
| Location | `candidate.profile.locationText` → same → `CandidateProfile.locationText` → `candidate.locationText`; no geographic inference |
| Date of Birth | `candidate.profile.dateOfBirth` → same, converted to database Date → `CandidateProfile.dateOfBirth` → `candidate.dateOfBirth` |
| Headline | `candidate.profile.headline` → same → `CandidateProfile.headline` → `candidate.headline` |
| Summary | `candidate.profile.summary` → same → `CandidateProfile.summary` → `candidate.summary` |
| Objective | `candidate.profile.objective` → same → `CandidateProfile.objective` → `candidate.objective` |
| Total Experience (Months) | `candidate.profile.totalExperienceMonths` → same → `CandidateProfile.totalExperienceMonths` → `candidate.totalExperienceMonths`; exports only the stored value |
| Notice Period | `candidate.profile.noticePeriod` → same → `CandidateProfile.noticePeriod` → `candidate.noticePeriod` |
| Employment Preferences | `candidate.profile.employmentPreferences` → same → `CandidateProfile.employmentPreferences` → `candidate.employmentPreferences` |
| Highest Qualification | Stored `CandidateEducation.degree/fieldOfStudy/endYear` via `highestEducation` (`lib/resume-overview.ts:73`); existing degree-rank then latest-end-year rule; no new inference rule |
| Qualifications | `candidate.additional.upsert` entries typed QUALIFICATION → `persistStructured` → `CandidateAdditional.title/details` → `candidate.additional` |
| Skills | `candidate.skills.upsert[].name` → skill resolution + ResumeSkill → `Skill.canonicalName`, all associations → `candidate.skills[].skill.canonicalName` |
| Top Skills | Same stored skills; reuse the list's first-five definition: confidence descending, NULL first as PostgreSQL DESC, skillId ascending (`lib/resume-overview.ts:31`). All remaining skills still appear in Skills/detail sheet |
| Employment History | `candidate.employment.upsert[]` → `persistStructured` → all `CandidateEmployment` entries → `candidate.employment[]`; summary employer/role |
| Employer | Same employment path → `.employer` |
| Job Title / Role | Same → `.designation` |
| Employment Start Date | `startDate.year/month/day/text` → flattened `startYear/Month/Day/Text` → same fields in `candidate.employment[]` |
| Employment End Date | `endDate.year/month/day/text` → `endYear/Month/Day/Text` → same; `isCurrent` retained in Employment sheet |
| Employment Description | Same employment path → `.description` |
| Education | `candidate.education.upsert[]` → `persistStructured` → all `CandidateEducation` entries → `candidate.education[]`; summary degree/institution |
| Degree | Same education path → `.degree` |
| Institution | Same → `.institution` |
| Specialization | Same → `.fieldOfStudy` |
| Graduation Year | Same → `.endYear`; no year inferred from text or another field |
| Projects | `candidate.projects.upsert[]` → `persistStructured` → `CandidateProject.name` → `candidate.projects[]` |
| Certifications | `candidate.certifications.upsert[]` → same → `CandidateCertification.name` → `candidate.certifications[]` |
| Links | `candidate.links.upsert[]` → same → `CandidateLink.url` → `candidate.links[]` |
| Additional Information | `candidate.additional.upsert[]` → same → `CandidateAdditional.type/title` → `candidate.additional[]` |

For human corrections, `patchCandidate` writes these same models/fields. Export has no fallback from a cleared basic value to a stale profile headline/name or old extraction evidence.

### Complete child-record worksheets

Every child row includes **Resume ID**. Ordered relations use position then ID; skills use skillId; links use ID. Skill aliases are sorted by normalizedName for deterministic serialization. Child confidence uses its stored 0–1 scale, separate from the original main-sheet percentage columns.

| Sheet | Persisted fields retained |
| --- | --- |
| Employment | id, position, employer, designation, location, employmentType, startYear/Month/Day/Text, endYear/Month/Day/Text, isCurrent, description, responsibilities, achievements, confidence, verifiedAt |
| Education | id, position, degree, fieldOfStudy, institution, location, startYear/Month/Day/Text, endYear/Month/Day/Text, grade, gradeScale, description, confidence, verifiedAt |
| Projects | id, position, name, description, role, startYear/Month/Day/Text, endYear/Month/Day/Text, url, responsibilities, achievements, all ProjectSkill associations with Skill data, confidence, verifiedAt |
| Certifications | id, position, name, issuer, credentialId, issueYear/Month/Day/Text, expiryYear/Month/Day/Text, url, confidence, verifiedAt |
| Skills | skillId, canonicalName, normalizedName, category, all SkillTerm aliases, originalText, context, confidence, verifiedAt |
| Links | id, type, url, label, verifiedAt |
| Additional | id, position, type, title, complete typed details JSON, confidence, verifiedAt |

Parser date objects are flattened by `dateFields` in `lib/resume-parser/persistence.ts:8`; section properties pass through `dataFields` (`:21`) and the explicit delegates (`:154`). ResumeSkill confidence comes from field evidence; project technologies use ProjectSkill. Languages, awards, publications, volunteering, internship and qualification records use CandidateAdditional types rather than invented sparse columns. The current parser explicitly emits several of those types; export also retains any supported typed records already stored by the existing edit APIs.

Main multi-record columns use numbered newline entries so missing positions do not shift employers relative to job titles/dates. Skills use semicolon summaries; complete original/context/alias records remain in the Skills sheet. Arrays and JSON details use compact JSON in detail cells, preserving embedded delimiters and record boundaries. Dates retain partial precision in comparison cells and **all numeric/text components** in detail sheets. No missing experience is converted to zero or Fresher; an explicitly stored zero remains zero.

Value States records NULL/absent, Blank, Empty array and No records separately, because XLSX blank cells alone do not preserve those distinctions. Long Values stores complete ordered chunks for cells exceeding Excel's 32,767-character limit; the main/detail cell points to those chunks. Unicode surrogate pairs are not split. Resume content is always serialized as primitive strings, never formula/hyperlink objects, including formula-like input. The original main sheet's colored header is preserved, with frozen ID/file columns and an autofilter added.

`app/(workspace)/export/page.tsx:1` and `client.tsx:3` remain unchanged. Page/API still require `resumes.export`. ALL, COMPLETED, REVIEW, FAILED, DUPLICATE, CANCELLED and REVIEWED API semantics are preserved; REVIEWED still uses basic extraction.reviewedAt. ALL still includes every status. Existing UI exposes its original subset of filters. Export retains 500-parent pagination, streaming, no-store headers and the existing export.completed audit entry. No parser call or candidate write was introduced. No separate export database copy was created.

Files changed for this task: `lib/excel-export.ts`, `app/api/export/route.ts`, new `tests/excel-export.test.ts`, and this report. The temporary read-only verification script was removed after use.

## E. Validation

- `npx tsc --noEmit`: passed; no TypeScript/schema-client mismatch found.
- Focused lint: `npx eslint lib/excel-export.ts app/api/export/route.ts tests/excel-export.test.ts`: passed.
- Relevant regression command: `npx vitest run tests/excel-export.test.ts tests/resume-parser.test.ts tests/processing.test.ts tests/resume-review.test.ts tests/resume-list-route.test.ts tests/review-workspace.test.ts tests/candidate-routes.test.ts --no-file-parallelism`: **73 tests passed across 7 files**, including **25 new export tests**; no final failures/skips in this run.
- New tests cover complete/basic-only payloads, absent location/experience, explicit zero/text, multiple employment/education/skills, REVIEW and COMPLETED values, persisted manual correction/clear behavior, Resume ID joins, empty relations, original columns/confidence meanings, all existing filters, 401/403 authorization, required actor, invalid filter, 501-row pagination, formula-like content, NULL-vs-blank state, long-cell reconstruction and database download failure.
- `npx next build`: passed, including production compilation, TypeScript and all 34 static pages. It emitted an existing workspace-root/ancestor-lockfile warning; no environment/config repair was made. A final deterministic alias-ordering adjustment is covered by the subsequent TypeScript/lint check and export tests.
- Live read-only workbook verification: **20 main rows**, **20 unique Resume IDs**, **50 columns**; Employment 9, Education 21, Projects 17, Certifications 76, Skills 36, Links 0, Additional 73, Value States 1,670, Long Values 0. Workbook was generated and loaded in memory; no candidate workbook artifact was written to disk.

Intermediate failures are disclosed: sandboxed Vitest initially could not spawn esbuild (`EPERM`); approved execution resolved it. The first workbook tests exposed that ExcelJS streaming worksheet views must be supplied when creating the sheet rather than assigned afterward; fixed and regression-tested. A parallel test/build run timed out on the 501-row test's default five-second limit; the final serial run passed that case in about 1.8 seconds with an explicit 30-second allowance. These were resolved validation issues, not hidden pre-existing parser failures.

The full opt-in database/OCR integration suite was not rerun: this request changed export only, uses safe synthetic mocks for new tests, and verified existing data through enforced read-only access. No integration schema/migration cleanup touched the development database. No authenticated live browser download or document-accuracy comparison was performed. Exports are not a transaction-wide snapshot across concurrent edits/pages; very large datasets remain bounded by Excel's worksheet row limits.

## F. Prioritized findings and next steps

1. **Fixed: export omission.** The old endpoint loaded only ResumeExtraction and the writer had 13 columns. It now loads authoritative candidate relations, preserves original columns, emits comparison/detail sheets, preserves missing values and prevents loss through one-to-many joins or long-cell truncation (`app/api/export/route.ts:55`; `lib/excel-export.ts:7`, `:36`, `:156`). Use Export → All resumes to compare the 20 persisted records.
2. **Confirmed stored-data gaps; exact cause still unassigned.** All 20 lack location; 9 lack designation; 19 lack total experience; 14 lack employment records. Historical warnings show substantial reading-order/employment uncertainty. Compare the exported gaps with the original PDFs before deciding which existing local rules need improvement (`identity-contact.ts:108`; `records.ts:183`, `:207`; `index.ts:42`). This requires a separate parser-accuracy task; no extraction rule changed here.
3. **Existing correction-protection behavior.** Any CandidateProfile blocks machine enrichment, even if sparse; reviewed basics also block machine replacement. Do not reprocess these records expecting v1.1 data to replace v1 values. Any future selective refresh needs explicitly approved ownership/revision/verification/deletion-aware behavior (`persistence.ts:99`; `processing.ts:157`; `candidate-data.ts:325`). No refresh was executed or implemented.
4. **Existing reader and presentation limits.** DOCX embedded images are not OCR'd, layout quality can be uncertain, and structured output has bounded validation/operation budgets. UI list summaries are capped; Details/export retain all persisted child data. Changing these limits or OCR/parser rules needs a separate scoped task (`document-reader.ts:159`; `index.ts:128`; `resume-overview.ts:31`). No historical persistence failure was confirmed.
5. **Prepared AI path remains inactive.** Future fallback orchestration, configuration review and any paid/remote calls require separate approval. They are unnecessary for this export and were not enabled (`basic.ts:272`; `resume-worker.ts:62`).

No architectural or database blocker prevented trustworthy export of the current persisted records. Missing stored information remains visibly missing; the export does not manufacture it.

## Appendix: per-field stored completeness

Each row examines the same 20 processed resumes. Child counts use the actual records in that table; a resume with no child records contributes to the no-value resume count, not the child NULL count. A resume can contain both populated and missing child entries. False/zero are explicit non-empty values. Empty arrays/objects and blank strings are counted separately from NULL. No candidate values appear here.

| Persisted field | Resumes with a value | Resumes with no value | Populated records | NULL records | Empty records |
| --- | ---: | ---: | ---: | ---: | ---: |
| ResumeExtraction.otherEmails | 0 | 20 | 0 | 0 | 20 |
| ResumeExtraction.countryCode | 20 | 0 | 20 | 0 | 0 |
| ResumeExtraction.normalizedPhone | 20 | 0 | 20 | 0 | 0 |
| CandidateEmployment.employer | 6 | 14 | 9 | 0 | 0 |
| CandidateEmployment.designation | 6 | 14 | 9 | 0 | 0 |
| CandidateEmployment.location | 0 | 20 | 0 | 9 | 0 |
| CandidateEmployment.employmentType | 0 | 20 | 0 | 9 | 0 |
| CandidateEmployment.startYear | 6 | 14 | 9 | 0 | 0 |
| CandidateEmployment.startMonth | 6 | 14 | 9 | 0 | 0 |
| CandidateEmployment.startDay | 0 | 20 | 0 | 9 | 0 |
| CandidateEmployment.startText | 6 | 14 | 9 | 0 | 0 |
| CandidateEmployment.endYear | 3 | 17 | 4 | 5 | 0 |
| CandidateEmployment.endMonth | 3 | 17 | 4 | 5 | 0 |
| CandidateEmployment.endDay | 0 | 20 | 0 | 9 | 0 |
| CandidateEmployment.endText | 3 | 17 | 4 | 5 | 0 |
| CandidateEmployment.isCurrent | 6 | 14 | 9 | 0 | 0 |
| CandidateEmployment.description | 6 | 14 | 9 | 0 | 0 |
| CandidateEmployment.responsibilities | 6 | 14 | 9 | 0 | 0 |
| CandidateEmployment.achievements | 5 | 15 | 5 | 0 | 4 |
| CandidateEducation.degree | 16 | 4 | 19 | 2 | 0 |
| CandidateEducation.fieldOfStudy | 16 | 4 | 19 | 2 | 0 |
| CandidateEducation.institution | 17 | 3 | 21 | 0 | 0 |
| CandidateEducation.location | 0 | 20 | 0 | 21 | 0 |
| CandidateEducation.startYear | 17 | 3 | 21 | 0 | 0 |
| CandidateEducation.startMonth | 17 | 3 | 21 | 0 | 0 |
| CandidateEducation.startDay | 0 | 20 | 0 | 21 | 0 |
| CandidateEducation.startText | 17 | 3 | 21 | 0 | 0 |
| CandidateEducation.endYear | 17 | 3 | 21 | 0 | 0 |
| CandidateEducation.endMonth | 17 | 3 | 21 | 0 | 0 |
| CandidateEducation.endDay | 0 | 20 | 0 | 21 | 0 |
| CandidateEducation.endText | 17 | 3 | 21 | 0 | 0 |
| CandidateEducation.grade | 17 | 3 | 21 | 0 | 0 |
| CandidateEducation.gradeScale | 17 | 3 | 21 | 0 | 0 |
| CandidateEducation.description | 17 | 3 | 21 | 0 | 0 |
| CandidateProject.name | 17 | 3 | 17 | 0 | 0 |
| CandidateProject.description | 17 | 3 | 17 | 0 | 0 |
| CandidateProject.role | 0 | 20 | 0 | 17 | 0 |
| CandidateProject.startYear | 17 | 3 | 17 | 0 | 0 |
| CandidateProject.startMonth | 17 | 3 | 17 | 0 | 0 |
| CandidateProject.startDay | 0 | 20 | 0 | 17 | 0 |
| CandidateProject.startText | 17 | 3 | 17 | 0 | 0 |
| CandidateProject.endYear | 17 | 3 | 17 | 0 | 0 |
| CandidateProject.endMonth | 17 | 3 | 17 | 0 | 0 |
| CandidateProject.endDay | 0 | 20 | 0 | 17 | 0 |
| CandidateProject.endText | 17 | 3 | 17 | 0 | 0 |
| CandidateProject.url | 17 | 3 | 17 | 0 | 0 |
| CandidateProject.responsibilities | 0 | 20 | 0 | 0 | 17 |
| CandidateProject.achievements | 0 | 20 | 0 | 0 | 17 |
| CandidateCertification.name | 17 | 3 | 76 | 0 | 0 |
| CandidateCertification.issuer | 0 | 20 | 0 | 76 | 0 |
| CandidateCertification.credentialId | 0 | 20 | 0 | 76 | 0 |
| CandidateCertification.issueYear | 0 | 20 | 0 | 76 | 0 |
| CandidateCertification.issueMonth | 0 | 20 | 0 | 76 | 0 |
| CandidateCertification.issueDay | 0 | 20 | 0 | 76 | 0 |
| CandidateCertification.issueText | 0 | 20 | 0 | 76 | 0 |
| CandidateCertification.expiryYear | 0 | 20 | 0 | 76 | 0 |
| CandidateCertification.expiryMonth | 0 | 20 | 0 | 76 | 0 |
| CandidateCertification.expiryDay | 0 | 20 | 0 | 76 | 0 |
| CandidateCertification.expiryText | 0 | 20 | 0 | 76 | 0 |
| CandidateCertification.url | 0 | 20 | 0 | 76 | 0 |
| CandidateLink.type | 0 | 20 | 0 | 0 | 0 |
| CandidateLink.url | 0 | 20 | 0 | 0 | 0 |
| CandidateLink.label | 0 | 20 | 0 | 0 | 0 |
| CandidateAdditional.type | 20 | 0 | 73 | 0 | 0 |
| CandidateAdditional.title | 20 | 0 | 73 | 0 | 0 |
| CandidateAdditional.details | 20 | 0 | 73 | 0 | 0 |
| ResumeSkill.originalText | 16 | 4 | 36 | 0 | 0 |
| ResumeSkill.context | 16 | 4 | 36 | 0 | 0 |
