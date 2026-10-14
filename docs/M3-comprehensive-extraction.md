# M3 comprehensive local extraction

M3 introduces `local-comprehensive-v1`. The worker now reads documents, normalizes
text, detects sections, extracts supported fields, validates machine output and
persists it inside M1's fenced finalization transaction. No paid model calls,
completeness calculation, job matching or candidate ranking are implemented.
M1's full staging acceptance remains pending.

## Architecture and compatibility

`lib/resume-parser.ts` remains the compatibility facade. `LocalResumeParser`,
`extractResumeFields`, `ResumeExtraction`, duplicate detection and the existing
AI abstraction remain exported. The legacy basic function retains filename and
national-phone fallback behavior for existing callers. The worker uses
`extractStructuredResume` and does not invent identity from a filename or assign
a calling country to a national number. Such phone text is preserved for review.

Modules under `lib/resume-parser/`:

- `document-reader`, `pdf-layout`, `document-limits`: bounded reading and selective OCR.
- `text-normalizer`, `section-detector`: Unicode cleanup, page/line references,
  headings, boundaries and independent aligned column sections.
- `extractors/identity-contact`, `professional`, `skills`, `records`, `profile-links`:
  source-supported field extraction.
- `dictionaries/skills`, `validators/dates`, `field-confidence`: taxonomy, partial
  dates, interval rules and explainable evidence.
- `persistence`, `evaluation`: transactional structured storage and ground-truth metrics.
- `basic`: compatible basic parser and the unused opt-in AI abstraction.

PDF positions come from public APIs of the already installed PDF.js dependency,
now explicitly declared as `pdfjs-dist@5.4.296`. The plain-text result from
pdf-parse merged synthetic columns; coordinate grouping preserves their gaps.
pdf-parse renders deficient pages. DOCX uses Mammoth HTML conversion to retain
table-cell separators and HTTP(S) links while omitting embedded image data.

## Fields and rules

Supported fields, when source structure is recognized:

- Full name; conservative two-token first/last split; validated primary/additional
  emails and international phones. References/recruiter contacts are excluded from
  candidate header/contact extraction. National phone text remains unnormalized
  and enters review when the calling country is unknown.
- Original location text; separately labelled city, state/region and country.
  DOB requires an explicit DOB label and a valid full date. Age and education dates
  never generate DOB or nationality.
- Current designation from known titles and current/latest employment context;
  original headline, summary and objective; explicitly stated experience,
  notice period and employment preferences. No summary is generated.
- Canonical skills, aliases, categories and contextual evidence. Technical,
  analytics, business, healthcare and general skills share one dictionary.
- Ordered employment: explicit employer/title, partial dates, present indicator,
  stated location/type, responsibilities, achievements and source description.
  Tools also become normalized resume skills. Internships use employment records
  with `employmentType: Internship`; freelance is recognized only when stated.
- Ordered education: recognized qualification, institution, explicit field of
  study, partial start/completion dates, stated grade/scale and original description.
- Named projects: original description, role, explicitly mentioned technologies,
  responsibilities, achievements, dates and safe links.
- Certifications: name, labelled issuer, issue/expiry dates, credential ID and URL.
- Header/contact LinkedIn, GitHub, portfolio, website and other HTTP(S) links.
- Explicit languages, awards, publications, volunteering and other qualifications
  in M2's typed additional records.

Unknown values remain null/empty. Existing basic REST fields, duplicate detection,
manual review and Excel exports remain supported. New information is available
through M2 candidate APIs; exports retain their existing columns.

### Skills

Matching is case insensitive with Unicode word boundaries and punctuation-aware
patterns. Java does not match JavaScript. Short aliases and ambiguous terms such
as R, Go, HR and Sales require skills/tool context. A title alone does not imply
skills. Associations deduplicate while retaining multiple occurrences as evidence.
Machine writes respect existing shared taxonomy names, categories and aliases.

### Dates and experience

Year-only dates remain year-only. Named month/year, numeric month/year and explicit
ISO full dates preserve their supplied precision and original text. Invalid or
reversed ranges are rejected. Ambiguous numeric day/month dates remain unresolved.

An explicit exact duration takes precedence over calculation. Approximate
expressions such as "over five years" are not converted into an exact total.
Calculated experience requires month precision for every recognized employment
entry. Half-open monthly intervals include an explicitly ended month and exclude
the current partial month. Their union prevents overlap double-counting. Gaps
contribute no time. Year-only/undated records suppress calculation. This is
documented employment duration, not verified tenure or suitability.

## Evidence, confidence and review

ExtractionRun identifies parser version, method and timestamps. Private evidence
stores bounded excerpts, logical field paths, page/normalized-line coordinates,
rule identifiers and heuristic confidence. Structured persisted paths use actual
record/skill IDs. Source coordinates reference extracted text, not bounding-box
locations in the original file.

The deterministic confidence rubric prioritizes explicit labels and validated
contacts, then recognized sections, then contextual mentions. It is not a
calibrated probability. Human verification timestamps remain null for machine
data; human corrections retain M2's separate HUMAN runs/audit references.

Uncertain employers, unresolved entries/phones, invalid or truncated structured
output, deficient text, rotated text, OCR quality and ambiguous layout generate
review warnings. Missing optional DOB, projects or certifications alone never
cause processing failure. M1's existing missing-basic-field review policy remains.
No document excerpts or candidate values appear in worker telemetry.

## Persistence and ownership

No M3 schema migration is required. All data fits M2's models.

Only a successfully fenced M1 finalization transaction may create the profile,
relations, taxonomy associations and evidence. Basic extraction, resume status,
duplicates, batch counts and structured storage commit or roll back together.
No reading, OCR or network work occurs inside that transaction. Expired, replaced
or cancelled claims cannot write results. Lease renewal continues during reading;
claim loss aborts reader work and subsequent boundaries recheck ownership.

The structured policy is deliberately **first-fill only**: if any CandidateProfile
already exists, the worker preserves the whole profile and all its sections.
Alternative machine evidence uses `observed.*` paths instead of implying a stored
correction. This protects manually edited and removed entries, legacy M2 profiles
and concurrent edits, without guessing ownership or recreating deleted records.
Repeated finalization cannot duplicate records or runs. Automatic profile refresh
and historical backfill are not provided; they require a future explicit merge
and review workflow. Existing verified basic corrections retain M1 precedence.

Expanded concurrent testing exposed synchronized database conflict retries. M1's
transaction helper now uses bounded exponential backoff with jitter (at most ten
transaction attempts). These do not consume document-processing attempts.

## Formats, limits and operations

Supported: text PDF, selectively OCRed scanned/mixed PDF, DOCX, PNG and JPG/JPEG.
Aligned PDF columns, common tables and multi-page documents have real fixture
tests. English OCR runs locally through Tesseract.js and its bundled native/WASM
dependencies; no language data or resume is uploaded to a model service.

Provision an uncompressed `eng.traineddata` in a private readable directory. Set
`OCR_LANG_PATH` to that directory; legacy `TESSDATA_PATH` is also accepted. The
working directory is the final fallback. No implicit data download is attempted.
Container deployments must provision/mount the data and include platform-native
canvas support. Missing language data is a bounded retryable dependency failure.

Default limits: 20 MiB document, 25 PDF pages, 200,000 extracted characters,
120-second reader deadline, 50 MiB declared DOCX expansion, 1,000 ZIP entries,
16 million image pixels and 10,000 pixels per side. PDF pages with extreme aspect
ratios or excessive text items are rejected. Structured output follows M2's
100-operation/200-taxonomy-reference budget. Excerpts are at most 500 characters;
machine evidence is capped at 1,500 items. Truncation triggers review.

PDF pages render individually at bounded width. OCR workers are reused across
pages of one document, then terminated. Native text pages avoid rendering/OCR.
Worker concurrency remains `WORKER_CONCURRENCY`; reducing it limits simultaneous
OCR memory. Reader options can override limits for controlled callers. Tesseract
and PDF tasks are terminated on cancellation/deadline. Mammoth parsing cannot be
hard-killed in-process; input/expansion limits reduce risk, but a hard CPU/memory
boundary would require process isolation.

## Evaluation and verification

The versioned synthetic corpus contains 18 ground-truth text cases covering the
requested professions and layouts, plus deliberately ambiguous employment and
multiple contacts/links. Seven generated real fixtures cover columns, multiple
pages, DOCX tables, PNG, JPG, scanned PDF and mixed native/scanned pages.

Metrics compare distinct normalized values per field: TP/FP/FN, precision, recall,
F1 and missing-field counts. Values from repeating entries use sets; this does not
measure relation alignment, entry ordering or duplicate counts. Dedicated tests
cover those properties. Document-level success means name and primary email were
recovered, not that every section is correct. OCR transcript extraction is distinct
from real image/PDF reading. The report separates reading quality signals,
reader latency, OCR pages and extraction metrics. Evidence confidence is not an
evaluation accuracy measure.

Latest text evaluation: 279 TP, 0 FP, 3 FN; precision 100%, recall 98.94%,
F1 99.47%; three missing fields. All misses concern the deliberately ambiguous
employment entry (employer/start/end). These high results on a small, rule-oriented
synthetic corpus do not establish production accuracy or universal format support.
Detailed results and measured latency are in `evaluation/M3-extraction.json`.

Reproduce:

```powershell
npx tsx scripts/generate-m3-fixtures.ts
npx tsx scripts/evaluate-extraction.ts
$env:M1_TEST_DATABASE_URL = "postgresql://test_user@localhost:5432/disposable_test_database"
$env:M2_TEST_DATABASE_URL = $env:M1_TEST_DATABASE_URL
$env:M3_TEST_DATABASE_URL = $env:M1_TEST_DATABASE_URL
npx prisma generate
npx prisma validate
npx tsc --noEmit
npx vitest run
npm run lint
npm run build
```

All database suites use explicitly supplied test URLs and random disposable
schemas. Without those variables their database tests are skipped. Tests must
never target production. Real OCR tests require the locally provisioned English
data. Fixture generation uses the installed canvas/ZIP dependencies; generated
fixtures are included with this change so ordinary tests do not need to regenerate them.

Final verification on a disposable loopback PostgreSQL 16 cluster passed 150 tests
in 11 files: the existing 98 tests and 52 M3 tests, with zero failed/skipped tests.
Prisma generation/validation, TypeScript, lint and production build passed.
The extraction evaluation script also completed with real local OCR. No production
migration, seed, commit or push was run. The test cluster was stopped and removed.

## Limitations and improvement workflow

- Names with initials, one token or complex cultural ordering may remain unknown
  or unsplit. Header/contact placement is assumed; candidate contacts scattered
  through arbitrary prose may be missed.
- Unknown titles, qualifications and skills need dictionary additions. Corporate
  descriptions, headings and unusual unlabelled record layouts remain difficult.
- Interleaved, rotated, decorative and nested layouts can remain ambiguous.
  Headers/footers with page-number patterns are removed; repeated arbitrary header
  text is not universally distinguished from body content.
- DOCX embedded images/text boxes, legacy DOC, handwriting and unsupported OCR
  languages are not comprehensively supported. Embedded DOCX images produce a
  warning instead of silently claiming full extraction.
- Mixed content is assessed per page, with sparse-text/image detection. A page
  with abundant readable text and a separate scanned block can escape OCR.
- Projects require identifiable names; prose is not split into invented projects.
  Academic/professional context is retained in original descriptions/evidence,
  not a newly inferred project classification.
- Real-world holdout evaluation, noisy/mobile scans, staging OCR/container checks,
  sustained batch load and memory measurements remain outstanding.

Improve a rule by adding an independently labelled synthetic/anonymized fixture,
a false-positive counterexample and a focused regression test. Add aliases and
categories in `dictionaries/skills.ts`; section variations belong in
`section-detector.ts`; qualifications and record boundary rules in `records.ts`.
Re-run the evaluation and inspect both misses and false positives before changing
confidence or acceptance behavior.

ConfiguredAIParser remains an abstraction for a future explicitly reviewed fallback.
The M3 worker never invokes it, even when previous AI environment flags are enabled.

## Recorded field evaluation

| Field | TP | FP | FN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| basic.name | 18 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| basic.email | 18 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| basic.otherEmails | 1 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| basic.normalizedPhone | 12 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| basic.designation | 15 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| profile.firstName | 18 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| profile.lastName | 18 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| profile.headline | 15 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| profile.summary | 2 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| profile.objective | 1 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| profile.locationText | 1 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| profile.city | 1 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| profile.region | 1 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| profile.country | 1 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| profile.dateOfBirth | 1 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| profile.noticePeriod | 1 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| profile.employmentPreferences | 2 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| profile.totalExperienceMonths | 8 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| profile.additionalPhones | 1 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| skills | 45 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| employment.employer | 12 | 0 | 1 | 100.00% | 92.31% | 96.00% |
| employment.designation | 13 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| employment.startDate | 13 | 0 | 1 | 100.00% | 92.86% | 96.30% |
| employment.endDate | 11 | 0 | 1 | 100.00% | 91.67% | 95.65% |
| education.degree | 11 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| education.institution | 11 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| education.fieldOfStudy | 4 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| education.endDate | 3 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| education.grade | 1 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| education.gradeScale | 1 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| projects.name | 2 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| projects.role | 1 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| projects.skills | 4 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| certifications.name | 2 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| certifications.issuer | 2 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| certifications.issueDate | 1 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| links.url | 3 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| additional.title | 4 | 0 | 0 | 100.00% | 100.00% | 100.00% |

Zero-support fields use —; a zero denominator is not perfect accuracy.

| Real fixture | Reader ms | OCR pages | Extraction TP/FP/FN |
| --- | ---: | ---: | --- |
| two-column.pdf | 1023 | 0 | 18/0/0 |
| multi-page.pdf | 461 | 0 | 16/0/0 |
| table.docx | 54 | 0 | 17/0/0 |
| scan.png | 1101 | 1 | 11/0/0 |
| scan.jpg | 1061 | 1 | 11/0/0 |
| scanned.pdf | 1703 | 1 | 11/0/0 |
| mixed.pdf | 1712 | 1 | 11/0/0 |

In this recorded run, text extraction median latency was 2.15 ms; the cold first case took 204.80 ms. These are local synthetic observations, not throughput guarantees. Real-document results above include reading/OCR; the transcript corpus does not use OCR.
