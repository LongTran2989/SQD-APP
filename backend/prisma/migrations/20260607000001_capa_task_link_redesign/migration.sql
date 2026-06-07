-- DropForeignKey
ALTER TABLE "CapaAction" DROP CONSTRAINT IF EXISTS "CapaAction_executionTaskId_fkey";
ALTER TABLE "CapaAction" DROP CONSTRAINT IF EXISTS "CapaAction_effectivenessTaskId_fkey";

-- DropColumn
ALTER TABLE "CapaAction" DROP COLUMN IF EXISTS "executionTaskId";
ALTER TABLE "CapaAction" DROP COLUMN IF EXISTS "effectivenessTaskId";

-- CreateTable
CREATE TABLE "CapaTaskLink" (
    "id" SERIAL NOT NULL,
    "capaId" INTEGER NOT NULL,
    "taskId" INTEGER,
    "wpId" INTEGER,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapaTaskLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CapaTaskLink_capaId_idx" ON "CapaTaskLink"("capaId");

-- AddForeignKey
ALTER TABLE "CapaTaskLink" ADD CONSTRAINT "CapaTaskLink_capaId_fkey" FOREIGN KEY ("capaId") REFERENCES "CapaAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CapaTaskLink" ADD CONSTRAINT "CapaTaskLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CapaTaskLink" ADD CONSTRAINT "CapaTaskLink_wpId_fkey" FOREIGN KEY ("wpId") REFERENCES "WorkPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
