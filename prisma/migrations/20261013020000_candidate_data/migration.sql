-- CreateEnum
CREATE TYPE "ExtractionMethod" AS ENUM ('LOCAL', 'HYBRID', 'HUMAN', 'IMPORT');

-- CreateEnum
CREATE TYPE "CandidateLinkType" AS ENUM ('LINKEDIN', 'GITHUB', 'PORTFOLIO', 'WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "CandidateAdditionalType" AS ENUM ('LANGUAGE', 'AWARD', 'PUBLICATION', 'VOLUNTEERING', 'INTERNSHIP', 'QUALIFICATION');

-- CreateTable
CREATE TABLE "CandidateProfile" (
    "resumeId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "firstName" TEXT,
    "lastName" TEXT,
    "additionalEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "additionalPhones" JSONB NOT NULL DEFAULT '[]',
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "locationText" TEXT,
    "dateOfBirth" DATE,
    "headline" TEXT,
    "summary" TEXT,
    "objective" TEXT,
    "totalExperienceMonths" INTEGER,
    "noticePeriod" TEXT,
    "employmentPreferences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateProfile_pkey" PRIMARY KEY ("resumeId")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillTerm" (
    "normalizedName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,

    CONSTRAINT "SkillTerm_pkey" PRIMARY KEY ("normalizedName")
);

-- CreateTable
CREATE TABLE "ResumeSkill" (
    "resumeId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "originalText" TEXT,
    "context" TEXT,
    "confidence" DOUBLE PRECISION,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "ResumeSkill_pkey" PRIMARY KEY ("resumeId","skillId")
);

-- CreateTable
CREATE TABLE "CandidateEmployment" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "employer" TEXT,
    "designation" TEXT,
    "location" TEXT,
    "employmentType" TEXT,
    "startYear" INTEGER,
    "startMonth" INTEGER,
    "startDay" INTEGER,
    "startText" TEXT,
    "endYear" INTEGER,
    "endMonth" INTEGER,
    "endDay" INTEGER,
    "endText" TEXT,
    "isCurrent" BOOLEAN,
    "description" TEXT,
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "achievements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "CandidateEmployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateEducation" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "degree" TEXT,
    "fieldOfStudy" TEXT,
    "institution" TEXT,
    "location" TEXT,
    "startYear" INTEGER,
    "startMonth" INTEGER,
    "startDay" INTEGER,
    "startText" TEXT,
    "endYear" INTEGER,
    "endMonth" INTEGER,
    "endDay" INTEGER,
    "endText" TEXT,
    "grade" TEXT,
    "gradeScale" TEXT,
    "description" TEXT,
    "confidence" DOUBLE PRECISION,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "CandidateEducation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateProject" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "role" TEXT,
    "startYear" INTEGER,
    "startMonth" INTEGER,
    "startDay" INTEGER,
    "startText" TEXT,
    "endYear" INTEGER,
    "endMonth" INTEGER,
    "endDay" INTEGER,
    "endText" TEXT,
    "url" TEXT,
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "achievements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "CandidateProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSkill" (
    "projectId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,

    CONSTRAINT "ProjectSkill_pkey" PRIMARY KEY ("projectId","skillId")
);

-- CreateTable
CREATE TABLE "CandidateCertification" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT,
    "issuer" TEXT,
    "credentialId" TEXT,
    "issueYear" INTEGER,
    "issueMonth" INTEGER,
    "issueDay" INTEGER,
    "issueText" TEXT,
    "expiryYear" INTEGER,
    "expiryMonth" INTEGER,
    "expiryDay" INTEGER,
    "expiryText" TEXT,
    "url" TEXT,
    "confidence" DOUBLE PRECISION,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "CandidateCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateLink" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "type" "CandidateLinkType" NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "CandidateLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateAdditional" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "CandidateAdditionalType" NOT NULL,
    "title" TEXT,
    "details" JSONB,
    "confidence" DOUBLE PRECISION,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "CandidateAdditional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionRun" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "parserVersion" TEXT,
    "method" "ExtractionMethod" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateEvidence" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "fieldPath" TEXT NOT NULL,
    "sourceSection" TEXT,
    "text" TEXT,
    "location" JSONB,
    "confidence" DOUBLE PRECISION,
    "verifiedAt" TIMESTAMP(3),
    "auditLogId" TEXT,

    CONSTRAINT "CandidateEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateProfile_city_country_idx" ON "CandidateProfile"("city", "country");

-- CreateIndex
CREATE INDEX "CandidateProfile_totalExperienceMonths_idx" ON "CandidateProfile"("totalExperienceMonths");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_normalizedName_key" ON "Skill"("normalizedName");

-- CreateIndex
CREATE INDEX "SkillTerm_skillId_idx" ON "SkillTerm"("skillId");

-- CreateIndex
CREATE INDEX "ResumeSkill_skillId_resumeId_idx" ON "ResumeSkill"("skillId", "resumeId");

-- CreateIndex
CREATE INDEX "CandidateEmployment_employer_idx" ON "CandidateEmployment"("employer");

-- CreateIndex
CREATE INDEX "CandidateEmployment_resumeId_startYear_startMonth_idx" ON "CandidateEmployment"("resumeId", "startYear", "startMonth");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateEmployment_resumeId_position_key" ON "CandidateEmployment"("resumeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateEmployment_resumeId_id_key" ON "CandidateEmployment"("resumeId", "id");

-- CreateIndex
CREATE INDEX "CandidateEducation_degree_fieldOfStudy_idx" ON "CandidateEducation"("degree", "fieldOfStudy");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateEducation_resumeId_position_key" ON "CandidateEducation"("resumeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateProject_resumeId_position_key" ON "CandidateProject"("resumeId", "position");

-- CreateIndex
CREATE INDEX "ProjectSkill_skillId_idx" ON "ProjectSkill"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateCertification_resumeId_position_key" ON "CandidateCertification"("resumeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateLink_resumeId_url_key" ON "CandidateLink"("resumeId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateAdditional_resumeId_position_key" ON "CandidateAdditional"("resumeId", "position");

-- CreateIndex
CREATE INDEX "ExtractionRun_resumeId_startedAt_idx" ON "ExtractionRun"("resumeId", "startedAt");

-- CreateIndex
CREATE INDEX "CandidateEvidence_runId_fieldPath_idx" ON "CandidateEvidence"("runId", "fieldPath");

-- AddForeignKey
ALTER TABLE "CandidateProfile" ADD CONSTRAINT "CandidateProfile_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillTerm" ADD CONSTRAINT "SkillTerm_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeSkill" ADD CONSTRAINT "ResumeSkill_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "CandidateProfile"("resumeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeSkill" ADD CONSTRAINT "ResumeSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateEmployment" ADD CONSTRAINT "CandidateEmployment_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "CandidateProfile"("resumeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateEducation" ADD CONSTRAINT "CandidateEducation_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "CandidateProfile"("resumeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateProject" ADD CONSTRAINT "CandidateProject_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "CandidateProfile"("resumeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSkill" ADD CONSTRAINT "ProjectSkill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CandidateProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSkill" ADD CONSTRAINT "ProjectSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateCertification" ADD CONSTRAINT "CandidateCertification_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "CandidateProfile"("resumeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateLink" ADD CONSTRAINT "CandidateLink_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "CandidateProfile"("resumeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAdditional" ADD CONSTRAINT "CandidateAdditional_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "CandidateProfile"("resumeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateEvidence" ADD CONSTRAINT "CandidateEvidence_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateEvidence" ADD CONSTRAINT "CandidateEvidence_auditLogId_fkey" FOREIGN KEY ("auditLogId") REFERENCES "AuditLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Additional integrity checks for future trusted extraction writers.
ALTER TABLE "ResumeSkill" ADD CONSTRAINT "ResumeSkill_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));
ALTER TABLE "CandidateEmployment" ADD CONSTRAINT "CandidateEmployment_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));
ALTER TABLE "CandidateEducation" ADD CONSTRAINT "CandidateEducation_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));
ALTER TABLE "CandidateProject" ADD CONSTRAINT "CandidateProject_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));
ALTER TABLE "CandidateCertification" ADD CONSTRAINT "CandidateCertification_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));
ALTER TABLE "CandidateAdditional" ADD CONSTRAINT "CandidateAdditional_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));
ALTER TABLE "CandidateEvidence" ADD CONSTRAINT "CandidateEvidence_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));
ALTER TABLE "CandidateEmployment" ADD CONSTRAINT "CandidateEmployment_start_partial_date" CHECK (("startYear" IS NULL AND "startMonth" IS NULL AND "startDay" IS NULL) OR ("startYear" IS NOT NULL AND "startYear" BETWEEN 1900 AND 2200 AND ("startMonth" IS NULL AND "startDay" IS NULL OR "startMonth" IS NOT NULL AND "startMonth" BETWEEN 1 AND 12 AND ("startDay" IS NULL OR "startDay" BETWEEN 1 AND EXTRACT(DAY FROM (make_date("startYear", "startMonth", 1) + INTERVAL '1 month' - INTERVAL '1 day'))))));
ALTER TABLE "CandidateEmployment" ADD CONSTRAINT "CandidateEmployment_end_partial_date" CHECK (("endYear" IS NULL AND "endMonth" IS NULL AND "endDay" IS NULL) OR ("endYear" IS NOT NULL AND "endYear" BETWEEN 1900 AND 2200 AND ("endMonth" IS NULL AND "endDay" IS NULL OR "endMonth" IS NOT NULL AND "endMonth" BETWEEN 1 AND 12 AND ("endDay" IS NULL OR "endDay" BETWEEN 1 AND EXTRACT(DAY FROM (make_date("endYear", "endMonth", 1) + INTERVAL '1 month' - INTERVAL '1 day'))))));
ALTER TABLE "CandidateEducation" ADD CONSTRAINT "CandidateEducation_start_partial_date" CHECK (("startYear" IS NULL AND "startMonth" IS NULL AND "startDay" IS NULL) OR ("startYear" IS NOT NULL AND "startYear" BETWEEN 1900 AND 2200 AND ("startMonth" IS NULL AND "startDay" IS NULL OR "startMonth" IS NOT NULL AND "startMonth" BETWEEN 1 AND 12 AND ("startDay" IS NULL OR "startDay" BETWEEN 1 AND EXTRACT(DAY FROM (make_date("startYear", "startMonth", 1) + INTERVAL '1 month' - INTERVAL '1 day'))))));
ALTER TABLE "CandidateEducation" ADD CONSTRAINT "CandidateEducation_end_partial_date" CHECK (("endYear" IS NULL AND "endMonth" IS NULL AND "endDay" IS NULL) OR ("endYear" IS NOT NULL AND "endYear" BETWEEN 1900 AND 2200 AND ("endMonth" IS NULL AND "endDay" IS NULL OR "endMonth" IS NOT NULL AND "endMonth" BETWEEN 1 AND 12 AND ("endDay" IS NULL OR "endDay" BETWEEN 1 AND EXTRACT(DAY FROM (make_date("endYear", "endMonth", 1) + INTERVAL '1 month' - INTERVAL '1 day'))))));
ALTER TABLE "CandidateProject" ADD CONSTRAINT "CandidateProject_start_partial_date" CHECK (("startYear" IS NULL AND "startMonth" IS NULL AND "startDay" IS NULL) OR ("startYear" IS NOT NULL AND "startYear" BETWEEN 1900 AND 2200 AND ("startMonth" IS NULL AND "startDay" IS NULL OR "startMonth" IS NOT NULL AND "startMonth" BETWEEN 1 AND 12 AND ("startDay" IS NULL OR "startDay" BETWEEN 1 AND EXTRACT(DAY FROM (make_date("startYear", "startMonth", 1) + INTERVAL '1 month' - INTERVAL '1 day'))))));
ALTER TABLE "CandidateProject" ADD CONSTRAINT "CandidateProject_end_partial_date" CHECK (("endYear" IS NULL AND "endMonth" IS NULL AND "endDay" IS NULL) OR ("endYear" IS NOT NULL AND "endYear" BETWEEN 1900 AND 2200 AND ("endMonth" IS NULL AND "endDay" IS NULL OR "endMonth" IS NOT NULL AND "endMonth" BETWEEN 1 AND 12 AND ("endDay" IS NULL OR "endDay" BETWEEN 1 AND EXTRACT(DAY FROM (make_date("endYear", "endMonth", 1) + INTERVAL '1 month' - INTERVAL '1 day'))))));
ALTER TABLE "CandidateCertification" ADD CONSTRAINT "CandidateCertification_issue_partial_date" CHECK (("issueYear" IS NULL AND "issueMonth" IS NULL AND "issueDay" IS NULL) OR ("issueYear" IS NOT NULL AND "issueYear" BETWEEN 1900 AND 2200 AND ("issueMonth" IS NULL AND "issueDay" IS NULL OR "issueMonth" IS NOT NULL AND "issueMonth" BETWEEN 1 AND 12 AND ("issueDay" IS NULL OR "issueDay" BETWEEN 1 AND EXTRACT(DAY FROM (make_date("issueYear", "issueMonth", 1) + INTERVAL '1 month' - INTERVAL '1 day'))))));
ALTER TABLE "CandidateCertification" ADD CONSTRAINT "CandidateCertification_expiry_partial_date" CHECK (("expiryYear" IS NULL AND "expiryMonth" IS NULL AND "expiryDay" IS NULL) OR ("expiryYear" IS NOT NULL AND "expiryYear" BETWEEN 1900 AND 2200 AND ("expiryMonth" IS NULL AND "expiryDay" IS NULL OR "expiryMonth" IS NOT NULL AND "expiryMonth" BETWEEN 1 AND 12 AND ("expiryDay" IS NULL OR "expiryDay" BETWEEN 1 AND EXTRACT(DAY FROM (make_date("expiryYear", "expiryMonth", 1) + INTERVAL '1 month' - INTERVAL '1 day'))))));
ALTER TABLE "CandidateProfile" ADD CONSTRAINT "CandidateProfile_experience_range" CHECK ("totalExperienceMonths" IS NULL OR "totalExperienceMonths" BETWEEN 0 AND 1200);
ALTER TABLE "CandidateEmployment" ADD CONSTRAINT "CandidateEmployment_current_end" CHECK ("isCurrent" IS DISTINCT FROM true OR ("endYear" IS NULL AND "endText" IS NULL));
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_timestamp_order" CHECK ("completedAt" IS NULL OR "completedAt" >= "startedAt");
