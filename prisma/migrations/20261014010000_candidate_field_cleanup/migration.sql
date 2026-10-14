-- M3.5: apply only after a verified backup and local-target confirmation.
-- Preservation and schema changes are atomic; unexpected data aborts the migration.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE "CandidateProfile", "ResumeExtraction" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "CandidateEvidence", "ExtractionRun" IN SHARE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "CandidateProfile" p LEFT JOIN "ResumeExtraction" e ON e."resumeId" = p."resumeId"
    WHERE (NULLIF(btrim(p."firstName"), '') IS NOT NULL OR NULLIF(btrim(p."lastName"), '') IS NOT NULL)
      AND regexp_replace(lower(btrim(concat_ws(' ', NULLIF(btrim(p."firstName"), ''), NULLIF(btrim(p."lastName"), '')))), '\s+', ' ', 'g')
        IS DISTINCT FROM regexp_replace(lower(btrim(e.name)), '\s+', ' ', 'g')
  ) THEN
    RAISE EXCEPTION 'M3.5 stopped: split names differ from the retained full name';
  END IF;
  IF EXISTS (SELECT 1 FROM "ResumeExtraction" WHERE coalesce(cardinality("otherEmails"), 0) > 0)
    OR EXISTS (SELECT 1 FROM "CandidateProfile" WHERE coalesce(cardinality("additionalEmails"), 0) > 0 OR "additionalPhones" IS DISTINCT FROM '[]'::jsonb)
  THEN
    RAISE EXCEPTION 'M3.5 stopped: unexpected secondary contacts require preservation review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "CandidateProfile" p CROSS JOIN LATERAL unnest(ARRAY[p.city, p.region, p.country]) component
    WHERE NULLIF(btrim(component), '') IS NOT NULL
      AND (component !~ '[[:alpha:]]' OR btrim(component) ~* '^(n\s*/\s*a|na|none|null|unknown|not[ _-]+(provided|available|applicable|specified)|unavailable|missing|tbd)[.!]?$')
  ) THEN
    RAISE EXCEPTION 'M3.5 stopped: invalid location components require review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "CandidateProfile" p
    WHERE NULLIF(btrim(p."locationText"), '') IS NULL
      AND coalesce(NULLIF(btrim(p.city), ''), NULLIF(btrim(p.region), ''), NULLIF(btrim(p.country), '')) IS NOT NULL
      AND (p."verifiedAt" IS NOT NULL OR EXISTS (
        SELECT 1 FROM "CandidateEvidence" evidence JOIN "ExtractionRun" run ON run.id = evidence."runId"
        WHERE run."resumeId" = p."resumeId" AND evidence."fieldPath" = 'profile.locationText' AND evidence."verifiedAt" IS NOT NULL
      ))
  ) THEN
    RAISE EXCEPTION 'M3.5 stopped: component backfill would overwrite a manual location clear';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "CandidateProfile" p CROSS JOIN LATERAL unnest(ARRAY[p.city, p.region, p.country]) component
    WHERE NULLIF(btrim(p."locationText"), '') IS NOT NULL AND NULLIF(btrim(component), '') IS NOT NULL
      AND position(regexp_replace(lower(btrim(component)), '\s+', ' ', 'g') IN regexp_replace(lower(btrim(p."locationText")), '\s+', ' ', 'g')) = 0
  ) THEN
    RAISE EXCEPTION 'M3.5 stopped: complete location conflicts with stored components';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "CandidateProfile"
    WHERE NULLIF(btrim("locationText"), '') IS NULL
      AND length(concat_ws(', ', NULLIF(btrim(city), ''), NULLIF(btrim(region), ''), NULLIF(btrim(country), ''))) > 500
  ) THEN
    RAISE EXCEPTION 'M3.5 stopped: consolidated location exceeds the retained field contract';
  END IF;
END $$;

-- Only explicit components are joined. No status, revision, verification,
-- provenance or unrelated candidate data is changed.
UPDATE "CandidateProfile"
SET "locationText" = concat_ws(', ', NULLIF(btrim(city), ''), NULLIF(btrim(region), ''), NULLIF(btrim(country), ''))
WHERE NULLIF(btrim("locationText"), '') IS NULL
  AND coalesce(NULLIF(btrim(city), ''), NULLIF(btrim(region), ''), NULLIF(btrim(country), '')) IS NOT NULL;

DROP INDEX "CandidateProfile_city_country_idx";
ALTER TABLE "CandidateProfile"
  DROP COLUMN "firstName",
  DROP COLUMN "lastName",
  DROP COLUMN "additionalEmails",
  DROP COLUMN "additionalPhones",
  DROP COLUMN "city",
  DROP COLUMN "region",
  DROP COLUMN "country";
ALTER TABLE "ResumeExtraction" DROP COLUMN "otherEmails";
COMMIT;
