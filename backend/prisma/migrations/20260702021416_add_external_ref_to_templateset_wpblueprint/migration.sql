-- AlterTable
ALTER TABLE "TemplateSet" ADD COLUMN     "externalRef" TEXT;

-- AlterTable
ALTER TABLE "WpBlueprint" ADD COLUMN     "externalRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TemplateSet_externalRef_key" ON "TemplateSet"("externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "WpBlueprint_externalRef_key" ON "WpBlueprint"("externalRef");
