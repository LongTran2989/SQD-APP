-- Replace CapaTaskLink.role (EXECUTION | EFFECTIVENESS | SUPPORTING) with a
-- binary `mandatory` flag. Mandatory links must be Closed before the CAPA can be
-- verified / the finding closed; non-mandatory links are reference-only.
-- Effectiveness verification moves to an explicit human sign-off at verify time.

-- AddColumn (default true so existing rows are mandatory unless mapped below)
ALTER TABLE "CapaTaskLink" ADD COLUMN "mandatory" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: EXECUTION / EFFECTIVENESS -> mandatory; SUPPORTING -> non-mandatory.
UPDATE "CapaTaskLink" SET "mandatory" = ("role" <> 'SUPPORTING');

-- DropColumn
ALTER TABLE "CapaTaskLink" DROP COLUMN "role";
