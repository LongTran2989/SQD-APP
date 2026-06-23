-- Give Finding a human-readable business identifier (findingId, e.g. FND-000001),
-- bringing it in line with Task.taskId / WorkPackage.wpId / Template.templateId.
-- Findings are organisation-wide, so the sequence is global (no division prefix).
--
-- Two-step, backfill-safe: add the column nullable, backfill existing rows in id
-- order, then add the UNIQUE index. New findings are assigned a code at creation
-- (generateFindingId, finding.controller.ts). Column stays nullable so historical
-- rows that predate any future tightening remain valid.

-- 1. Add the column (nullable).
ALTER TABLE "Finding" ADD COLUMN "findingId" TEXT;

-- 2. Backfill existing rows: FND-000001, FND-000002, … assigned in ascending id
--    order so the codes track creation order (matches the generator's assumption).
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM "Finding"
)
UPDATE "Finding" f
SET "findingId" = 'FND-' || LPAD(numbered.rn::text, 6, '0')
FROM numbered
WHERE f.id = numbered.id;

-- 3. Enforce uniqueness (matches @unique in schema.prisma; name matches Prisma's
--    convention so `db push` and this migration converge on the same index).
CREATE UNIQUE INDEX "Finding_findingId_key" ON "Finding"("findingId");
