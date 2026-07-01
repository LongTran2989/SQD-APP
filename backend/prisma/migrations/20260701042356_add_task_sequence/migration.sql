-- CreateTable
CREATE TABLE "TaskSequence" (
    "divisionCode" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TaskSequence_pkey" PRIMARY KEY ("divisionCode")
);

-- Backfill: seed TaskSequence with the highest already-issued sequence number
-- per division, so IDs generated going forward never collide with existing
-- Task rows (including soft-deleted ones — taskId stays globally unique
-- regardless of deletedAt). Divisions with no existing tasks get no row;
-- their first generateTaskId() upsert correctly starts them at 1.
INSERT INTO "TaskSequence" ("divisionCode", "sequence")
SELECT
  split_part("taskId", '-', 1) AS "divisionCode",
  MAX(CAST(split_part("taskId", '-', 2) AS INTEGER)) AS "sequence"
FROM "Task"
WHERE "taskId" ~ '^[A-Za-z0-9]+-[0-9]+$'
GROUP BY split_part("taskId", '-', 1)
ON CONFLICT ("divisionCode") DO UPDATE SET "sequence" = EXCLUDED."sequence";
