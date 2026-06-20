-- CreateIndex
CREATE INDEX "WpBlueprint_isActive_recurrenceType_nextRunAt_idx" ON "WpBlueprint"("isActive", "recurrenceType", "nextRunAt");

-- CreateIndex
CREATE INDEX "WpBlueprint_divisionId_isActive_idx" ON "WpBlueprint"("divisionId", "isActive");

-- CreateIndex
CREATE INDEX "TemplateSet_divisionId_isActive_idx" ON "TemplateSet"("divisionId", "isActive");

-- CreateIndex
CREATE INDEX "WorkPackage_blueprintId_idx" ON "WorkPackage"("blueprintId");
