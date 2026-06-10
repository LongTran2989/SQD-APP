-- Workflow overhaul — PR 1: additive schema only (zero behaviour change).
-- All changes are purely additive (new nullable columns, defaulted columns,
-- indexes, and one nullable FK), and therefore reversible.

-- AlterTable: User UI preferences
ALTER TABLE "User" ADD COLUMN     "preferences" JSONB;

-- AlterTable: Template skill level
ALTER TABLE "Template" ADD COLUMN     "skillLevel" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: Task per-task skill level + approval gate
ALTER TABLE "Task" ADD COLUMN     "skillLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: WorkPackage type-specific fields
ALTER TABLE "WorkPackage" ADD COLUMN     "acRegistration" TEXT,
ADD COLUMN     "customer" TEXT,
ADD COLUMN     "authority" TEXT,
ADD COLUMN     "targetDepartmentId" INTEGER;

-- CreateIndex: hot list-view filters
CREATE INDEX "Task_assignedToUserId_status_deletedAt_idx" ON "Task"("assignedToUserId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "Task_issuerId_status_deletedAt_idx" ON "Task"("issuerId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "WorkPackage_targetDepartmentId_idx" ON "WorkPackage"("targetDepartmentId");

-- AddForeignKey: WorkPackage.targetDepartment (AUDIT type) — nullable, ON DELETE SET NULL
ALTER TABLE "WorkPackage" ADD CONSTRAINT "WorkPackage_targetDepartmentId_fkey" FOREIGN KEY ("targetDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
