-- CreateEnum
CREATE TYPE "ResumeStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVIEW', 'DUPLICATE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExtractionMethod" AS ENUM ('LOCAL', 'HYBRID', 'HUMAN', 'IMPORT');

-- CreateEnum
CREATE TYPE "CandidateLinkType" AS ENUM ('LINKEDIN', 'GITHUB', 'PORTFOLIO', 'WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "CandidateAdditionalType" AS ENUM ('LANGUAGE', 'AWARD', 'PUBLICATION', 'VOLUNTEERING', 'INTERNSHIP', 'QUALIFICATION');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleKey" TEXT NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleKey","permission")
);

-- CreateTable
CREATE TABLE "UserPermissionGrant" (
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermissionGrant_pkey" PRIMARY KEY ("userId","permission")
);

-- CreateTable
CREATE TABLE "Resume" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "status" "ResumeStatus" NOT NULL DEFAULT 'PENDING',
    "claimToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "processingGeneration" INTEGER NOT NULL DEFAULT 0,
    "processingAttempts" INTEGER NOT NULL DEFAULT 0,
    "scheduleAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "batchId" TEXT,
    "duplicateOf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeExtraction" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "name" TEXT,
    "nameConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "email" TEXT,
    "emailConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "phone" TEXT,
    "countryCode" TEXT,
    "normalizedPhone" TEXT,
    "phoneConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "designation" TEXT,
    "designationConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overallConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "requiresReview" BOOLEAN NOT NULL DEFAULT true,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingBatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "processedFiles" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "batchId" TEXT,
    "queueJobId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Duplicate" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "originalResumeId" TEXT NOT NULL,
    "matchType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Duplicate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionError" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "errorType" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateProfile" (
    "resumeId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Resume_filePath_key" ON "Resume"("filePath");

-- CreateIndex
CREATE INDEX "Resume_status_createdAt_idx" ON "Resume"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Resume_status_scheduleAfter_idx" ON "Resume"("status", "scheduleAfter");

-- CreateIndex
CREATE INDEX "Resume_status_leaseUntil_idx" ON "Resume"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "Resume_batchId_status_idx" ON "Resume"("batchId", "status");

-- CreateIndex
CREATE INDEX "Resume_fileHash_idx" ON "Resume"("fileHash");

-- CreateIndex
CREATE INDEX "Resume_processedAt_idx" ON "Resume"("processedAt");

-- CreateIndex
CREATE INDEX "Resume_fileName_idx" ON "Resume"("fileName");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeExtraction_resumeId_key" ON "ResumeExtraction"("resumeId");

-- CreateIndex
CREATE INDEX "ResumeExtraction_email_idx" ON "ResumeExtraction"("email");

-- CreateIndex
CREATE INDEX "ResumeExtraction_normalizedPhone_idx" ON "ResumeExtraction"("normalizedPhone");

-- CreateIndex
CREATE INDEX "ResumeExtraction_requiresReview_overallConfidence_idx" ON "ResumeExtraction"("requiresReview", "overallConfidence");

-- CreateIndex
CREATE INDEX "ProcessingBatch_status_createdAt_idx" ON "ProcessingBatch"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingJob_queueJobId_key" ON "ProcessingJob"("queueJobId");

-- CreateIndex
CREATE INDEX "Duplicate_matchType_idx" ON "Duplicate"("matchType");

-- CreateIndex
CREATE UNIQUE INDEX "Duplicate_resumeId_originalResumeId_key" ON "Duplicate"("resumeId", "originalResumeId");

-- CreateIndex
CREATE INDEX "ExtractionError_resumeId_createdAt_idx" ON "ExtractionError"("resumeId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

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
ALTER TABLE "User" ADD CONSTRAINT "User_role_fkey" FOREIGN KEY ("role") REFERENCES "Role"("key") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleKey_fkey" FOREIGN KEY ("roleKey") REFERENCES "Role"("key") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "UserPermissionGrant" ADD CONSTRAINT "UserPermissionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProcessingBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeExtraction" ADD CONSTRAINT "ResumeExtraction_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProcessingBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Duplicate" ADD CONSTRAINT "Duplicate_originalResumeId_fkey" FOREIGN KEY ("originalResumeId") REFERENCES "Resume"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionError" ADD CONSTRAINT "ExtractionError_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
