-- Notification Event Configuration — admin-configurable per event class.
-- Additive and fully reversible: DROP TABLE. A config artifact, NOT a
-- compliance record (AuditLog remains the system-of-record). Optional FK to the
-- last updater; ON DELETE SET NULL so hard-deleting a user during test teardown
-- never FK-errors and the config row survives.

-- CreateTable
CREATE TABLE "NotificationEventConfig" (
    "eventKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "ccManagers" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" INTEGER,

    CONSTRAINT "NotificationEventConfig_pkey" PRIMARY KEY ("eventKey")
);

-- AddForeignKey
ALTER TABLE "NotificationEventConfig" ADD CONSTRAINT "NotificationEventConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
