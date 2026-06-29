-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Department" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Division" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Division_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "employeeId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "forcePasswordChange" BOOLEAN NOT NULL DEFAULT true,
    "resetPasswordToken" TEXT,
    "resetPasswordExpires" TIMESTAMP(3),
    "activeSessionId" TEXT,
    "divisionId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,
    "preferences" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operator" (
    "iataCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("iataCode")
);

-- CreateTable
CREATE TABLE "Authority" (
    "code" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,

    CONSTRAINT "Authority_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "AircraftType" (
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AircraftType_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "AircraftRegistration" (
    "registration" TEXT NOT NULL,
    "description" TEXT,
    "serialNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "aircraftTypeCode" TEXT,
    "operatorCode" TEXT,
    "authorityCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AircraftRegistration_pkey" PRIMARY KEY ("registration")
);

-- CreateTable
CREATE TABLE "UserAircraftAuthorization" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "aircraftTypeCode" TEXT NOT NULL,

    CONSTRAINT "UserAircraftAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorizationType" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,

    CONSTRAINT "AuthorizationType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserJobAuthorization" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "authorizationTypeId" INTEGER NOT NULL,

    CONSTRAINT "UserJobAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" SERIAL NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "allowsFindings" BOOLEAN NOT NULL DEFAULT true,
    "estimatedHours" DOUBLE PRECISION,
    "skillLevel" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT,
    "externalRef" TEXT,
    "formSchema" JSONB NOT NULL,
    "draftSchema" JSONB,
    "divisionId" INTEGER NOT NULL,
    "revisedByUserId" INTEGER,
    "revisedAt" TIMESTAMP(3),
    "ownerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateRevisionArchive" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "formSchema" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "revisedByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateRevisionArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" SERIAL NOT NULL,
    "taskId" TEXT NOT NULL,
    "title" TEXT,
    "templateId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Unassigned',
    "issuerId" INTEGER NOT NULL,
    "assignedToUserId" INTEGER,
    "wpId" INTEGER,
    "deadline" TIMESTAMP(3),
    "deadlineExtensions" JSONB,
    "inactivationLog" JSONB,
    "rejectionReason" TEXT,
    "rating" INTEGER,
    "estimatedHours" DOUBLE PRECISION,
    "skillLevel" INTEGER NOT NULL DEFAULT 0,
    "issuanceNote" TEXT,
    "responseActionType" TEXT,
    "requiresDirectorApproval" BOOLEAN NOT NULL DEFAULT false,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "assignmentType" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "schemaSnapshot" JSONB NOT NULL,
    "targetDivisionId" INTEGER,
    "parentFindingId" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskData" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" SERIAL NOT NULL,
    "findingId" TEXT,
    "severity" TEXT,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "fieldId" TEXT,
    "dueDate" TIMESTAMP(3),
    "eventType" TEXT NOT NULL,
    "aircraftRegistrationCode" TEXT,
    "regulatoryReference" TEXT,
    "sourceTaskId" INTEGER,
    "reportedByUserId" INTEGER NOT NULL,
    "closedByUserId" INTEGER,
    "targetDivisionId" INTEGER,
    "departmentId" INTEGER NOT NULL,
    "ataChapterId" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RcaInvestigation" (
    "id" SERIAL NOT NULL,
    "findingId" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "causeCodeId" INTEGER,
    "conductedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RcaInvestigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RcaWhyStep" (
    "id" SERIAL NOT NULL,
    "rcaId" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RcaWhyStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RcaContributingFactor" (
    "id" SERIAL NOT NULL,
    "rcaId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "detail" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RcaContributingFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapaAction" (
    "id" SERIAL NOT NULL,
    "findingId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerUserId" INTEGER,
    "deadline" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Open',
    "verifiedByUserId" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "waivedReason" TEXT,
    "createdByUserId" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapaAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapaTaskLink" (
    "id" SERIAL NOT NULL,
    "capaId" INTEGER NOT NULL,
    "taskId" INTEGER,
    "wpId" INTEGER,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapaTaskLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtaChapter" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtaChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CauseCode" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupCode" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CauseCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HazardTag" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HazardTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingHazardTag" (
    "id" SERIAL NOT NULL,
    "findingId" INTEGER NOT NULL,
    "hazardTagId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingHazardTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingLink" (
    "id" SERIAL NOT NULL,
    "fromFindingId" INTEGER NOT NULL,
    "relatedFindingId" INTEGER NOT NULL,
    "linkType" TEXT NOT NULL,
    "note" TEXT,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingResponseAction" (
    "id" SERIAL NOT NULL,
    "findingId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "taskId" INTEGER,
    "procedureRef" TEXT,
    "note" TEXT,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FindingResponseAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingResponseActionDepartment" (
    "id" SERIAL NOT NULL,
    "responseActionId" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingResponseActionDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "actionType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "performedByUserId" INTEGER NOT NULL,
    "comment" TEXT,
    "details" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "linkScope" TEXT,
    "linkId" INTEGER,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationEventConfig" (
    "eventKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "ccManagers" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" INTEGER,

    CONSTRAINT "NotificationEventConfig_pkey" PRIMARY KEY ("eventKey")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "WorkPackage" (
    "id" SERIAL NOT NULL,
    "wpId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "divisionId" INTEGER NOT NULL,
    "timeframeFrom" TIMESTAMP(3) NOT NULL,
    "timeframeTo" TIMESTAMP(3) NOT NULL,
    "creatorId" INTEGER NOT NULL,
    "autoGenerate" BOOLEAN NOT NULL DEFAULT false,
    "autoGenMode" TEXT,
    "autoGenInterval" INTEGER,
    "autoGenTemplateId" INTEGER,
    "autoGenSetId" INTEGER,
    "autoGenInlineSet" JSONB,
    "autoGenFiredAt" TIMESTAMP(3),
    "blueprintId" INTEGER,
    "isRoutine" BOOLEAN NOT NULL DEFAULT false,
    "acRegistration" TEXT,
    "customer" TEXT,
    "authority" TEXT,
    "targetDepartmentId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "inactivationLog" JSONB,
    "closedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPackageAssignment" (
    "id" SERIAL NOT NULL,
    "wpId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkPackageAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WpType" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WpType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateSet" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "divisionId" INTEGER NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateSetItem" (
    "id" SERIAL NOT NULL,
    "setId" INTEGER NOT NULL,
    "templateId" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "deadlineOffsetDays" INTEGER,
    "estimatedHours" DOUBLE PRECISION,
    "skillLevel" INTEGER,
    "requiresApproval" BOOLEAN,
    "defaultNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateSetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WpBlueprint" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "divisionId" INTEGER NOT NULL,
    "defaultDuration" INTEGER NOT NULL,
    "defaultAutoGenerate" BOOLEAN NOT NULL DEFAULT false,
    "defaultAutoGenMode" TEXT,
    "defaultAutoGenInterval" INTEGER,
    "defaultAutoGenTemplateId" INTEGER,
    "defaultAutoGenSetId" INTEGER,
    "defaultAutoGenInlineSet" JSONB,
    "recurrenceType" TEXT,
    "recurrenceInterval" INTEGER,
    "recurrenceStartDate" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "targetDepartmentId" INTEGER,
    "acRegistration" TEXT,
    "customer" TEXT,
    "authority" TEXT,
    "ownerId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WpBlueprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventType" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedPost" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" INTEGER,
    "authorId" INTEGER,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "sourcePostId" INTEGER,
    "sourceExcerpt" TEXT,
    "sourceTaskId" INTEGER,
    "sourceWpId" INTEGER,
    "flagId" INTEGER,
    "taggedDivisionIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationFlag" (
    "id" SERIAL NOT NULL,
    "sourcePostId" INTEGER NOT NULL,
    "flaggedByUserId" INTEGER NOT NULL,
    "targetScope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedByUserId" INTEGER,
    "action" TEXT,
    "actionedAt" TIMESTAMP(3),
    "linkedEntityType" TEXT,
    "linkedEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscalationFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeBooking" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "assigneeEntry" JSONB NOT NULL,
    "collaborators" JSONB NOT NULL,
    "totalHours" DOUBLE PRECISION NOT NULL,
    "estimatedHours" DOUBLE PRECISION,
    "overBudgetReason" TEXT,
    "overBudgetNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeBooking_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "PrivilegeConfig" (
    "id" SERIAL NOT NULL,
    "roleId" INTEGER NOT NULL,
    "permissions" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivilegeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" SERIAL NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "bucket" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fieldId" TEXT,
    "uploadedById" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Division_code_key" ON "Division"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserAircraftAuthorization_userId_aircraftTypeCode_key" ON "UserAircraftAuthorization"("userId", "aircraftTypeCode");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorizationType_code_key" ON "AuthorizationType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "UserJobAuthorization_userId_authorizationTypeId_key" ON "UserJobAuthorization"("userId", "authorizationTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_templateId_key" ON "Template"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_externalRef_key" ON "Template"("externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "Task_taskId_key" ON "Task"("taskId");

-- CreateIndex
CREATE INDEX "Task_status_deletedAt_idx" ON "Task"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "Task_targetDivisionId_status_deletedAt_idx" ON "Task"("targetDivisionId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "Task_templateId_status_deletedAt_idx" ON "Task"("templateId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "Task_assignedToUserId_status_deletedAt_idx" ON "Task"("assignedToUserId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "Task_issuerId_status_deletedAt_idx" ON "Task"("issuerId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "Task_completedAt_idx" ON "Task"("completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskData_taskId_key" ON "TaskData"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_findingId_key" ON "Finding"("findingId");

-- CreateIndex
CREATE INDEX "Finding_departmentId_ataChapterId_idx" ON "Finding"("departmentId", "ataChapterId");

-- CreateIndex
CREATE INDEX "Finding_status_deletedAt_idx" ON "Finding"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "Finding_targetDivisionId_status_deletedAt_idx" ON "Finding"("targetDivisionId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "Finding_reportedByUserId_deletedAt_idx" ON "Finding"("reportedByUserId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RcaInvestigation_findingId_key" ON "RcaInvestigation"("findingId");

-- CreateIndex
CREATE INDEX "RcaInvestigation_method_idx" ON "RcaInvestigation"("method");

-- CreateIndex
CREATE INDEX "RcaInvestigation_causeCodeId_idx" ON "RcaInvestigation"("causeCodeId");

-- CreateIndex
CREATE INDEX "RcaWhyStep_rcaId_idx" ON "RcaWhyStep"("rcaId");

-- CreateIndex
CREATE UNIQUE INDEX "RcaWhyStep_rcaId_orderIndex_key" ON "RcaWhyStep"("rcaId", "orderIndex");

-- CreateIndex
CREATE INDEX "RcaContributingFactor_rcaId_idx" ON "RcaContributingFactor"("rcaId");

-- CreateIndex
CREATE INDEX "CapaAction_findingId_idx" ON "CapaAction"("findingId");

-- CreateIndex
CREATE INDEX "CapaAction_type_status_idx" ON "CapaAction"("type", "status");

-- CreateIndex
CREATE INDEX "CapaTaskLink_capaId_idx" ON "CapaTaskLink"("capaId");

-- CreateIndex
CREATE UNIQUE INDEX "AtaChapter_code_key" ON "AtaChapter"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CauseCode_code_key" ON "CauseCode"("code");

-- CreateIndex
CREATE INDEX "CauseCode_groupCode_idx" ON "CauseCode"("groupCode");

-- CreateIndex
CREATE UNIQUE INDEX "HazardTag_label_key" ON "HazardTag"("label");

-- CreateIndex
CREATE INDEX "FindingHazardTag_hazardTagId_idx" ON "FindingHazardTag"("hazardTagId");

-- CreateIndex
CREATE UNIQUE INDEX "FindingHazardTag_findingId_hazardTagId_key" ON "FindingHazardTag"("findingId", "hazardTagId");

-- CreateIndex
CREATE INDEX "FindingLink_relatedFindingId_idx" ON "FindingLink"("relatedFindingId");

-- CreateIndex
CREATE UNIQUE INDEX "FindingLink_fromFindingId_relatedFindingId_linkType_key" ON "FindingLink"("fromFindingId", "relatedFindingId", "linkType");

-- CreateIndex
CREATE UNIQUE INDEX "FindingResponseAction_taskId_key" ON "FindingResponseAction"("taskId");

-- CreateIndex
CREATE INDEX "FindingResponseAction_findingId_idx" ON "FindingResponseAction"("findingId");

-- CreateIndex
CREATE INDEX "FindingResponseAction_type_idx" ON "FindingResponseAction"("type");

-- CreateIndex
CREATE INDEX "FindingResponseActionDepartment_departmentId_idx" ON "FindingResponseActionDepartment"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "FindingResponseActionDepartment_responseActionId_department_key" ON "FindingResponseActionDepartment"("responseActionId", "departmentId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPackage_wpId_key" ON "WorkPackage"("wpId");

-- CreateIndex
CREATE INDEX "WorkPackage_targetDepartmentId_idx" ON "WorkPackage"("targetDepartmentId");

-- CreateIndex
CREATE INDEX "WorkPackage_autoGenerate_status_deletedAt_idx" ON "WorkPackage"("autoGenerate", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "WorkPackage_blueprintId_idx" ON "WorkPackage"("blueprintId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPackageAssignment_wpId_userId_key" ON "WorkPackageAssignment"("wpId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WpType_code_key" ON "WpType"("code");

-- CreateIndex
CREATE INDEX "TemplateSet_divisionId_isActive_idx" ON "TemplateSet"("divisionId", "isActive");

-- CreateIndex
CREATE INDEX "TemplateSetItem_setId_idx" ON "TemplateSetItem"("setId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateSetItem_setId_orderIndex_key" ON "TemplateSetItem"("setId", "orderIndex");

-- CreateIndex
CREATE INDEX "WpBlueprint_isActive_recurrenceType_nextRunAt_idx" ON "WpBlueprint"("isActive", "recurrenceType", "nextRunAt");

-- CreateIndex
CREATE INDEX "WpBlueprint_divisionId_isActive_idx" ON "WpBlueprint"("divisionId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "EventType_code_key" ON "EventType"("code");

-- CreateIndex
CREATE INDEX "FeedPost_scope_scopeId_createdAt_idx" ON "FeedPost"("scope", "scopeId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedPost_flagId_idx" ON "FeedPost"("flagId");

-- CreateIndex
CREATE INDEX "EscalationFlag_targetScope_status_idx" ON "EscalationFlag"("targetScope", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TimeBooking_taskId_key" ON "TimeBooking"("taskId");

-- CreateIndex
CREATE INDEX "TimeEntry_taskId_loggedAt_idx" ON "TimeEntry"("taskId", "loggedAt");

-- CreateIndex
CREATE INDEX "TimeEntry_loggedByUserId_idx" ON "TimeEntry"("loggedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivilegeConfig_roleId_key" ON "PrivilegeConfig"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_entityType_entityId_deletedAt_idx" ON "Attachment"("entityType", "entityId", "deletedAt");

-- CreateIndex
CREATE INDEX "Attachment_uploadedById_idx" ON "Attachment"("uploadedById");

-- AddForeignKey
ALTER TABLE "Division" ADD CONSTRAINT "Division_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AircraftRegistration" ADD CONSTRAINT "AircraftRegistration_aircraftTypeCode_fkey" FOREIGN KEY ("aircraftTypeCode") REFERENCES "AircraftType"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AircraftRegistration" ADD CONSTRAINT "AircraftRegistration_operatorCode_fkey" FOREIGN KEY ("operatorCode") REFERENCES "Operator"("iataCode") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AircraftRegistration" ADD CONSTRAINT "AircraftRegistration_authorityCode_fkey" FOREIGN KEY ("authorityCode") REFERENCES "Authority"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAircraftAuthorization" ADD CONSTRAINT "UserAircraftAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAircraftAuthorization" ADD CONSTRAINT "UserAircraftAuthorization_aircraftTypeCode_fkey" FOREIGN KEY ("aircraftTypeCode") REFERENCES "AircraftType"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserJobAuthorization" ADD CONSTRAINT "UserJobAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserJobAuthorization" ADD CONSTRAINT "UserJobAuthorization_authorizationTypeId_fkey" FOREIGN KEY ("authorizationTypeId") REFERENCES "AuthorizationType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_revisedByUserId_fkey" FOREIGN KEY ("revisedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateRevisionArchive" ADD CONSTRAINT "TemplateRevisionArchive_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateRevisionArchive" ADD CONSTRAINT "TemplateRevisionArchive_revisedByUserId_fkey" FOREIGN KEY ("revisedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_wpId_fkey" FOREIGN KEY ("wpId") REFERENCES "WorkPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_targetDivisionId_fkey" FOREIGN KEY ("targetDivisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentFindingId_fkey" FOREIGN KEY ("parentFindingId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskData" ADD CONSTRAINT "TaskData_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_aircraftRegistrationCode_fkey" FOREIGN KEY ("aircraftRegistrationCode") REFERENCES "AircraftRegistration"("registration") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_targetDivisionId_fkey" FOREIGN KEY ("targetDivisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_ataChapterId_fkey" FOREIGN KEY ("ataChapterId") REFERENCES "AtaChapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcaInvestigation" ADD CONSTRAINT "RcaInvestigation_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcaInvestigation" ADD CONSTRAINT "RcaInvestigation_causeCodeId_fkey" FOREIGN KEY ("causeCodeId") REFERENCES "CauseCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcaInvestigation" ADD CONSTRAINT "RcaInvestigation_conductedByUserId_fkey" FOREIGN KEY ("conductedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcaWhyStep" ADD CONSTRAINT "RcaWhyStep_rcaId_fkey" FOREIGN KEY ("rcaId") REFERENCES "RcaInvestigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcaContributingFactor" ADD CONSTRAINT "RcaContributingFactor_rcaId_fkey" FOREIGN KEY ("rcaId") REFERENCES "RcaInvestigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapaAction" ADD CONSTRAINT "CapaAction_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapaAction" ADD CONSTRAINT "CapaAction_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapaAction" ADD CONSTRAINT "CapaAction_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapaAction" ADD CONSTRAINT "CapaAction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapaTaskLink" ADD CONSTRAINT "CapaTaskLink_capaId_fkey" FOREIGN KEY ("capaId") REFERENCES "CapaAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapaTaskLink" ADD CONSTRAINT "CapaTaskLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapaTaskLink" ADD CONSTRAINT "CapaTaskLink_wpId_fkey" FOREIGN KEY ("wpId") REFERENCES "WorkPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingHazardTag" ADD CONSTRAINT "FindingHazardTag_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingHazardTag" ADD CONSTRAINT "FindingHazardTag_hazardTagId_fkey" FOREIGN KEY ("hazardTagId") REFERENCES "HazardTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingLink" ADD CONSTRAINT "FindingLink_fromFindingId_fkey" FOREIGN KEY ("fromFindingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingLink" ADD CONSTRAINT "FindingLink_relatedFindingId_fkey" FOREIGN KEY ("relatedFindingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingLink" ADD CONSTRAINT "FindingLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingResponseAction" ADD CONSTRAINT "FindingResponseAction_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingResponseAction" ADD CONSTRAINT "FindingResponseAction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingResponseAction" ADD CONSTRAINT "FindingResponseAction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingResponseActionDepartment" ADD CONSTRAINT "FindingResponseActionDepartment_responseActionId_fkey" FOREIGN KEY ("responseActionId") REFERENCES "FindingResponseAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingResponseActionDepartment" ADD CONSTRAINT "FindingResponseActionDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEventConfig" ADD CONSTRAINT "NotificationEventConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackage" ADD CONSTRAINT "WorkPackage_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackage" ADD CONSTRAINT "WorkPackage_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackage" ADD CONSTRAINT "WorkPackage_autoGenTemplateId_fkey" FOREIGN KEY ("autoGenTemplateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackage" ADD CONSTRAINT "WorkPackage_autoGenSetId_fkey" FOREIGN KEY ("autoGenSetId") REFERENCES "TemplateSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackage" ADD CONSTRAINT "WorkPackage_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "WpBlueprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackage" ADD CONSTRAINT "WorkPackage_targetDepartmentId_fkey" FOREIGN KEY ("targetDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackageAssignment" ADD CONSTRAINT "WorkPackageAssignment_wpId_fkey" FOREIGN KEY ("wpId") REFERENCES "WorkPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackageAssignment" ADD CONSTRAINT "WorkPackageAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateSet" ADD CONSTRAINT "TemplateSet_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateSet" ADD CONSTRAINT "TemplateSet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateSetItem" ADD CONSTRAINT "TemplateSetItem_setId_fkey" FOREIGN KEY ("setId") REFERENCES "TemplateSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateSetItem" ADD CONSTRAINT "TemplateSetItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WpBlueprint" ADD CONSTRAINT "WpBlueprint_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WpBlueprint" ADD CONSTRAINT "WpBlueprint_defaultAutoGenTemplateId_fkey" FOREIGN KEY ("defaultAutoGenTemplateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WpBlueprint" ADD CONSTRAINT "WpBlueprint_defaultAutoGenSetId_fkey" FOREIGN KEY ("defaultAutoGenSetId") REFERENCES "TemplateSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WpBlueprint" ADD CONSTRAINT "WpBlueprint_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_sourcePostId_fkey" FOREIGN KEY ("sourcePostId") REFERENCES "FeedPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_flagId_fkey" FOREIGN KEY ("flagId") REFERENCES "EscalationFlag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeBooking" ADD CONSTRAINT "TimeBooking_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_loggedByUserId_fkey" FOREIGN KEY ("loggedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivilegeConfig" ADD CONSTRAINT "PrivilegeConfig_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

