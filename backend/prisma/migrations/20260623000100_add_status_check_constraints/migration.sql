-- Data-integrity hardening: enforce the status/severity enumerations at the DB
-- level. These columns are free-text String in Prisma (no native enum), validated
-- only in the application layer today, which allows silent drift (e.g. the dead
-- 'Approved' Task status, or a typo'd 'In progress'). Prisma cannot express CHECK
-- constraints in schema.prisma, so they live here in raw SQL only.
--
-- Values are the authoritative sets from backend/src/constants/* :
--   TASK_STATUSES        (constants/taskStatus.ts)
--   FINDING_STATUSES     (constants/findingTaxonomy.ts)
--   FINDING_SEVERITIES   (constants/findingTaxonomy.ts) — nullable
--   WorkPackage statuses (constants / status machine)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- MANDATORY PRE-DEPLOY DATA AUDIT (run against the target DB before applying):
--   SELECT DISTINCT status   FROM "Task";
--   SELECT DISTINCT status   FROM "Finding";
--   SELECT DISTINCT severity FROM "Finding";
--   SELECT DISTINCT status   FROM "WorkPackage";
-- If any value is NOT in the sets below, ADD CONSTRAINT will fail — fix the data
-- first. (Verified at authoring time that no code path WRITES an off-list value,
-- and that 'Approved' is never written, but legacy rows must still be audited.)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_status_check"
  CHECK ("status" IN (
    'Unassigned', 'Assigned', 'In Progress', 'In Review',
    'Follow-up Required', 'Closed', 'Rejected', 'Terminated', 'Inactive'
  ));

ALTER TABLE "Finding"
  ADD CONSTRAINT "Finding_status_check"
  CHECK ("status" IN (
    'Open', 'In Progress', 'Pending Verification', 'Closed', 'Dismissed'
  ));

-- severity is nullable: allow NULL OR a member of FINDING_SEVERITIES.
ALTER TABLE "Finding"
  ADD CONSTRAINT "Finding_severity_check"
  CHECK ("severity" IS NULL OR "severity" IN (
    'Observation', 'Level 1', 'Level 2'
  ));

ALTER TABLE "WorkPackage"
  ADD CONSTRAINT "WorkPackage_status_check"
  CHECK ("status" IN (
    'Open', 'In Progress', 'Overdue', 'Closed', 'Inactive'
  ));

-- A finding may never be cross-referenced to itself. The application already
-- rejects this (findingLink.controller.ts), so this is belt-and-suspenders.
ALTER TABLE "FindingLink"
  ADD CONSTRAINT "FindingLink_no_self_reference_check"
  CHECK ("fromFindingId" <> "relatedFindingId");
