-- Retire deprecated Stage-2 analytical fields on Finding (superseded by the
-- structured RCA + CAPA workflows) and the vestigial, never-used deletedAt on
-- FindingResponseAction (append-only rows). All confirmed unreferenced in code.

ALTER TABLE "Finding" DROP COLUMN IF EXISTS "category";
ALTER TABLE "Finding" DROP COLUMN IF EXISTS "errorCode";
ALTER TABLE "Finding" DROP COLUMN IF EXISTS "rootCause";
ALTER TABLE "Finding" DROP COLUMN IF EXISTS "correctiveAction";
ALTER TABLE "Finding" DROP COLUMN IF EXISTS "recurrence";
ALTER TABLE "Finding" DROP COLUMN IF EXISTS "violatorIds";

ALTER TABLE "FindingResponseAction" DROP COLUMN IF EXISTS "deletedAt";
