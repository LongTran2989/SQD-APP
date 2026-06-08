-- AlterTable
ALTER TABLE "TimeBooking" ADD COLUMN     "overBudgetNote" TEXT,
ADD COLUMN     "overBudgetReason" TEXT;

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "loggedByUserId" INTEGER NOT NULL,
    "sessionHours" DOUBLE PRECISION NOT NULL,
    "sessionNotes" TEXT NOT NULL,
    "collaboratorEntries" JSONB NOT NULL,
    "overBudgetReason" TEXT,
    "overBudgetNote" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeEntry_taskId_loggedAt_idx" ON "TimeEntry"("taskId", "loggedAt");

-- CreateIndex
CREATE INDEX "TimeEntry_loggedByUserId_idx" ON "TimeEntry"("loggedByUserId");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_loggedByUserId_fkey" FOREIGN KEY ("loggedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
