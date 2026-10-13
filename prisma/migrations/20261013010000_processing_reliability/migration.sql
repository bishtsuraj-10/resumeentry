ALTER TABLE "Resume"
 ADD COLUMN "claimToken" TEXT,
 ADD COLUMN "leaseUntil" TIMESTAMP(3),
 ADD COLUMN "processingGeneration" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "processingAttempts" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "scheduleAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "Resume_status_scheduleAfter_idx" ON "Resume"("status", "scheduleAfter");
CREATE INDEX "Resume_status_leaseUntil_idx" ON "Resume"("status", "leaseUntil");
