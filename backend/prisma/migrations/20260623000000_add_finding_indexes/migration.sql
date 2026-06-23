-- Add indexes for the hottest Finding read paths. Finding previously carried only
-- @@index([departmentId, ataChapterId]) (trend recurrence), leaving the dashboard
-- status counts, division dashboards, and the "my reported findings" feed/list to
-- sequential scans. All filter deletedAt: null (Rule 2), so it trails each composite.
--
-- Prod deploy note: prefer CREATE INDEX CONCURRENTLY in the deploy runbook to avoid
-- locking the table on a large dataset. Plain CREATE INDEX is used here for the
-- migration file (cheap on the current small dataset). Index names match Prisma's
-- @@index naming convention.

-- CreateIndex
CREATE INDEX "Finding_status_deletedAt_idx" ON "Finding"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "Finding_targetDivisionId_status_deletedAt_idx" ON "Finding"("targetDivisionId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "Finding_reportedByUserId_deletedAt_idx" ON "Finding"("reportedByUserId", "deletedAt");
