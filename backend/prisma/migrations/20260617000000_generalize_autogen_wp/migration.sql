-- Generalize auto-generated WP tasks: TemplateSet + WpBlueprint, per-WP autoGen
-- config, and migration of the special CHECK path onto the generalized model.
--
-- ORDER MATTERS: add the new columns, backfill existing CHECK WPs from
-- checkTemplateId, and only THEN drop checkTemplateId. Splitting the ALTER this
-- way (vs. the default Prisma diff, which drops + adds in one statement) makes
-- the data migration non-destructive.

-- 1. New tables --------------------------------------------------------------

-- CreateTable
CREATE TABLE "TemplateSet" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "divisionId" INTEGER NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateSetItem" (
    "id" SERIAL NOT NULL,
    "setId" INTEGER NOT NULL,
    "templateId" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "deadlineOffsetDays" INTEGER,
    "estimatedHours" DOUBLE PRECISION,
    "skillLevel" INTEGER,
    "requiresApproval" BOOLEAN,
    "defaultNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateSetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WpBlueprint" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "divisionId" INTEGER NOT NULL,
    "defaultDuration" INTEGER NOT NULL,
    "defaultAutoGenerate" BOOLEAN NOT NULL DEFAULT false,
    "defaultAutoGenMode" TEXT,
    "defaultAutoGenInterval" INTEGER,
    "defaultAutoGenTemplateId" INTEGER,
    "defaultAutoGenSetId" INTEGER,
    "defaultAutoGenInlineSet" JSONB,
    "recurrenceType" TEXT,
    "recurrenceInterval" INTEGER,
    "targetDepartmentId" INTEGER,
    "acRegistration" TEXT,
    "customer" TEXT,
    "authority" TEXT,
    "ownerId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WpBlueprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemplateSetItem_setId_idx" ON "TemplateSetItem"("setId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateSetItem_setId_orderIndex_key" ON "TemplateSetItem"("setId", "orderIndex");

-- 2. Add the new WorkPackage columns (keep checkTemplateId for now) -----------

-- AlterTable
ALTER TABLE "WorkPackage"
ADD COLUMN     "autoGenFiredAt" TIMESTAMP(3),
ADD COLUMN     "autoGenInlineSet" JSONB,
ADD COLUMN     "autoGenInterval" INTEGER,
ADD COLUMN     "autoGenMode" TEXT,
ADD COLUMN     "autoGenSetId" INTEGER,
ADD COLUMN     "autoGenTemplateId" INTEGER,
ADD COLUMN     "autoGenerate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "blueprintId" INTEGER,
ADD COLUMN     "isRoutine" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "WorkPackage_autoGenerate_status_deletedAt_idx" ON "WorkPackage"("autoGenerate", "status", "deletedAt");

-- 3. Foreign keys ------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "WorkPackage" ADD CONSTRAINT "WorkPackage_autoGenTemplateId_fkey" FOREIGN KEY ("autoGenTemplateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackage" ADD CONSTRAINT "WorkPackage_autoGenSetId_fkey" FOREIGN KEY ("autoGenSetId") REFERENCES "TemplateSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackage" ADD CONSTRAINT "WorkPackage_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "WpBlueprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateSet" ADD CONSTRAINT "TemplateSet_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateSet" ADD CONSTRAINT "TemplateSet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateSetItem" ADD CONSTRAINT "TemplateSetItem_setId_fkey" FOREIGN KEY ("setId") REFERENCES "TemplateSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateSetItem" ADD CONSTRAINT "TemplateSetItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WpBlueprint" ADD CONSTRAINT "WpBlueprint_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WpBlueprint" ADD CONSTRAINT "WpBlueprint_defaultAutoGenTemplateId_fkey" FOREIGN KEY ("defaultAutoGenTemplateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WpBlueprint" ADD CONSTRAINT "WpBlueprint_defaultAutoGenSetId_fkey" FOREIGN KEY ("defaultAutoGenSetId") REFERENCES "TemplateSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WpBlueprint" ADD CONSTRAINT "WpBlueprint_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Backfill existing CHECK WPs onto the generalized REPEAT (daily) model ----
--    Preserves the previous "one task per day from checkTemplateId" behaviour.
UPDATE "WorkPackage"
SET "autoGenerate" = true,
    "autoGenMode" = 'REPEAT',
    "autoGenInterval" = 1,
    "autoGenTemplateId" = "checkTemplateId"
WHERE "type" = 'CHECK' AND "checkTemplateId" IS NOT NULL;

-- 5. Drop the now-migrated column (irreversible — backfill above must run first)
ALTER TABLE "WorkPackage" DROP COLUMN "checkTemplateId";
