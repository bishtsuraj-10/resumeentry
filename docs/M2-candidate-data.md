# M2 candidate data foundation

M2 adds validated candidate persistence and provenance. It does not add extraction
algorithms, AI providers, completeness calculations, job matching or ranking.
M1 staging acceptance remains pending.

## Architecture

ResumeExtraction remains the authoritative source for the existing name, email,
otherEmails, phone, calling code, normalized phone, designation and extraction
confidence fields. Its existing schema and export columns are unchanged.

An optional CandidateProfile belongs to a Resume. It holds first/last name,
location, explicit DOB, candidate-provided headline/summary/objective, stated
experience months, notice period and employment preferences. Unknown values
remain null; collections default to empty. A worker does not create this profile.

CandidateProfile.additionalEmails and additionalPhones hold human-supplied
additional contacts separately from the legacy parser's otherEmails. Consumers
can combine those lists with primary/extracted contacts and deduplicate values.
This separation preserves human additions during M1 processing. Phone input
must be an explicitly international number; normalization never assumes a country.
DOB is date-only and never contributes to any score.

Repeating sections use CandidateEmployment, CandidateEducation, CandidateProject,
CandidateCertification and CandidateLink. Less common languages, awards,
publications, volunteering, internships and qualifications share CandidateAdditional
with a typed, bounded details JSON object. These sections have Resume/Profile
foreign keys and cascade when their Resume is deleted.

Ordering uses unique resume/position pairs (0–499). Updates may atomically swap
existing positions; transaction-local temporary positions never commit. At most
100 records per section are persisted through the API.

Partial dates use separate nullable year/month/day components plus original text.
Year-only values never receive invented months or days. Education endDate means
completion date; certification dates use issueDate/expiryDate. Unknown textual
dates such as "Summer 2020" are retained without interpretation. Date ranges are
checked only as far as their supplied precision permits.
Supplying a date object replaces that date's stored precision; omitting the date
preserves it, and null clears it.

Skills use Skill, SkillTerm, ResumeSkill and ProjectSkill. Names are normalized
with Unicode NFKC, whitespace normalization and case folding while preserving
technology punctuation. Canonical terms and aliases share a unique namespace.
Resume and project skill associations have compound primary keys. Candidate
edits may add aliases but cannot rename or recategorize an existing shared skill.
Conflicting aliases return 409; occurrence evidence survives association deduplication.
Removing an association never deletes the shared taxonomy.

Indexes support resume-owned collections, skill-to-resume/project lookup,
employment dates/employers, education fields, locations and stated experience.
Detail reads use fixed nested relation queries rather than a query per entry.
Existing paginated lists and streaming Excel exports do not load the new relations.

## Confidence, verification and future scores

Existing overallConfidence is extraction confidence only. Structured entry and
evidence confidence is nullable and database-constrained to 0–1. Human API edits
cannot assign confidence; they preserve prior machine confidence and record
verification timestamps and HUMAN provenance separately. An entry's verifiedAt
records its latest human edit; field/section references identify what was edited.

No completeness or match-score table/value is populated. These concepts remain
separate future work. Sensitive characteristics are not used for ranking.

## Provenance and privacy

ExtractionRun records method, parser version, started/completed timestamps and a
stable run ID. LOCAL finalization records local-basic-v1 and four basic field
confidence references in M1's existing fenced transaction. The existing explicitly
enabled AI helper is labelled HYBRID only if it changes a stored field; no new
AI integration or calls were introduced. Failed attempts remain in ExtractionError.

Human structured edits and legacy four-field reviews create HUMAN runs linked
to existing audit events. Audit metadata contains revision/section identifiers,
not submitted candidate values. CandidateEvidence stores a logical fieldPath,
optional section, at most 500 characters of text, page/line coordinates,
confidence and verification/audit references. Historical logical paths can remain
after an entry is removed, preserving correction references. They are not file paths.

Ordinary reads omit evidence and original skill excerpts. Private evidence requires
resumes.edit. Provenance pages return 25 runs with the first 100 evidence items
per run plus _count.evidence. A run-specific request pages all evidence in groups
of 100. Resume deletion cascades both structured data and evidence. Audit deletion
sets optional evidence audit references to null. No entire document copies are stored.
Evidence retention follows Resume retention; no additional retention scheduler is added.

Internal file paths, claim tokens, leases and scheduling timestamps are omitted
from resume detail/list responses. All candidate/provenance reads disable caching.

## APIs

Existing GET /api/resumes/[id] retains legacy extraction and adds candidate,
which is null for legacy/unpopulated resumes. Existing four-field PATCH keeps
its M1 ownership-safe behavior and does not alter structured relations.
Existing list pagination, statuses, retry/cancellation and exports remain compatible.

New endpoints:

| Endpoint | Permission | Response |
| --- | --- | --- |
| GET /api/resumes/[id]/candidate | resumes.view | resumeId, revision, basic extraction, optional candidate with related sections |
| PATCH /api/resumes/[id]/candidate | resumes.edit and authenticated actor | new revision |
| GET /api/resumes/[id]/candidate/provenance?page=1 | resumes.edit | 25 runs, bounded evidence previews and counts |
| GET /api/resumes/[id]/candidate/provenance?runId=ID&page=1 | resumes.edit | candidate-owned run and 100 evidence items |

The application uses its existing role/permission access model. There is no new
tenant/owner model. Every supplied entry/run ID is scoped to the route's Resume;
cross-candidate IDs cannot update, delete or expose another candidate's records.

PATCH requires expectedRevision from the previous read (0 for no profile).
Serializable transactions and a conditional revision update protect coordinated
changes. Concurrent/obsolete edits return 409 and must reload. Structured editing
does not revoke a live basic extraction claim: M1 cannot overwrite these separate
models. Cancelled resumes/batches reject edits.

profile contains only the new optional scalar/contact fields. Repeating sections
use upsert and remove arrays. An entry without id creates a record; an id updates
only fields explicitly supplied. remove requires owned IDs; it never means
"delete all". Omitted sections/fields are preserved. Explicitly supplied profile
lists replace that list; explicitly supplied project.skills replaces only that
project's skill associations. skills.remove contains skill IDs; other remove
lists contain section entry IDs.

Example (synthetic values):

```json
{
  "expectedRevision": 0,
  "profile": {
    "headline": "Candidate supplied headline",
    "summary": null,
    "employmentPreferences": ["Remote"]
  },
  "skills": {
    "upsert": [{
      "name": "Node.js",
      "aliases": ["NodeJS"],
      "category": "Technical",
      "originalText": "NodeJS",
      "evidence": [{ "sourceSection": "Skills", "text": "NodeJS", "location": { "page": 1 } }]
    }]
  },
  "employment": {
    "upsert": [{
      "employer": "Synthetic employer",
      "designation": "Engineer",
      "startDate": { "year": 2022, "month": 6 },
      "isCurrent": true
    }]
  },
  "projects": {
    "upsert": [{
      "name": "Synthetic project",
      "skills": [{ "name": "NodeJS" }],
      "url": "https://example.com/project"
    }]
  }
}
```

Additional details allow organization, description, proficiency, url, startDate
and endDate. The associated title/type identifies the qualification, language,
publication, volunteering or internship. Arbitrary nested JSON is rejected.

Writes require JSON and enforce a streamed 256 KiB limit, at most 100 entry
operations, 200 taxonomy references/aliases and 200 supplied evidence items per
request. Arrays/strings also have individual limits. Prefer small interactive
updates; very large edits may exceed bounded transaction time and roll back safely.
URLs must be absolute HTTP(S) without embedded credentials; fragments are removed.
No URL is fetched.

Responses: 400 invalid input; 401 missing session; 403 permission denial;
404 missing or unowned record; 409 revision/taxonomy/uniqueness conflict or cancelled
record; 413 oversized body; 415 incorrect content type; 422 inconsistent ranges,
missing required entry fields or stored section limits. Dependency errors return
a generic 500 without private exception details.

## Migration and deployment

20261013020000_candidate_data creates 13 new tables and three enums. Only relation
declarations are added to existing Resume and AuditLog models; no legacy field is
removed, renamed, rewritten or required. Foreign keys, ordering/link uniqueness,
taxonomy/association indexes and SQL integrity checks are included.

SQL checks cover structured confidence, partial calendar dates, experience
range, current-employment end dates, and run timestamp order. Preserve these checks
when generating future migrations; Prisma schema syntax does not describe them.

1. Back up the database and stop old application/worker processes during rollout.
2. Review the additive migration in development/staging first.
3. Generate Prisma Client: `npx prisma generate`.
4. Using the intended deployment database only, run `npx prisma migrate deploy`.
5. Deploy/start web and worker together. The new code expects provenance tables.
6. Verify a legacy resume, existing review/export, a candidate patch and worker
   completion. Resume M1 staging acceptance separately.

Production migration was not run by this implementation. Prisma migrate deploy
and migrate status were executed only against a disposable loopback PostgreSQL 16
cluster. Integration tests also apply migrations in random isolated schemas and
insert a legacy verified extraction before M2 to verify preservation.

## Verification

```powershell
$env:M1_TEST_DATABASE_URL = "postgresql://test_user:password@localhost:5432/test_database"
$env:M2_TEST_DATABASE_URL = $env:M1_TEST_DATABASE_URL
npx vitest run
npx tsc --noEmit
npx prisma validate
npm run lint
npm run build
```

Both database suites require explicit test URLs; otherwise they are skipped.
Use a dedicated development/test database with schema-creation permission.
Tests create and delete only their own random schemas; no production data or seeds
are used. Coverage includes all M1 regressions, migration preservation, all
structured sections, partial/null data, skill aliases, ownership, revision races,
rollback, cascade behavior, evidence pagination, permissions, body limits and
legacy GET/PATCH/worker compatibility.

Verified on the disposable PostgreSQL 16 cluster: 8 test files, 98 tests passed
(49 existing M1/baseline tests and 49 M2 tests), with no skipped or failed tests.
TypeScript, Prisma validation, lint and production build passed. Prisma deployment
and migration status also passed on that disposable cluster.

Remaining acceptance work: authenticated browser/staging verification and realistic
large-data performance. M1's pending Redis reconnect/OCR/Docker checks remain pending.
