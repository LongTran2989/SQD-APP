-- Workflow overhaul — PR 11 (cleanup): drop the deprecated Template.isOneOff column.
-- One-off auto-archival behaviour was removed in PR 2; the column has been unused
-- since. This is the intentional, irreversible Phase B of the isOneOff removal.

ALTER TABLE "Template" DROP COLUMN IF EXISTS "isOneOff";
