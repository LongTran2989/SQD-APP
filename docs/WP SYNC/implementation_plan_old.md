# Google Sheet WP Sync Implementation Plan

This document outlines the implementation plan for syncing the maintenance schedule from the Google Sheet into SQD-APP as Work Packages, incorporating rigorous architectural and compliance requirements.

## User Review Required

> [!IMPORTANT]
> **Name Collision & Rescheduling Handling**
> You asked: *"if a WP is opened, then rescheduled, what will be your behaviour?"*
> **Answer**: The sync will detect the date mismatch, flag the WP as **"To Update"** in the Preview UI, and upon your confirmation, it will update the `timeframeFrom` and `timeframeTo` in the database (generating a mandatory `AuditLog` event).
>
> You asked to *"Flag [name collisions] and let the user review and decide."*
> **Answer**: I have added a new section to the Preview UI called **"Collisions / Conflicts"**. If the sheet has a WP No. that already exists in SQD-APP as a "Closed" or "Inactive" WP, it will appear here. You will have options to:
> 1. Ignore it (do nothing).
> 2. Create it as a NEW Work Package (we will automatically append `-REV2` to the name to guarantee database uniqueness and prevent overlapping data).
> Please confirm if this `-REV2` suffix approach for forcing a new active WP is acceptable to you.

## Proposed Changes

We will build a backend service to fetch the Google Sheet, parse the CSV securely, compare it against existing WPs (respecting soft-deletes), and provide a Preview-then-Confirm flow in the Master Calendar UI.

---

### Backend Logic

#### [NEW] `backend/src/services/googleSheetSync.service.ts`
- **`fetchAndParseSheet()`**:
  - Fetches the Google Sheet CSV export.
  - Parses using `xlsx`.
  - **Zod Validation**: Validates the incoming CSV data structurally (ensuring dates are parseable, required columns like `TAT` and `WP No.` are present) before processing.
  - Filters rows where: `Station` is HAN (QCH) or SGN (QCS), `WP No.` includes "CHK", and `WP Status Name` = "In Preparation".
- **`getPreviewData()`**:
  - Compares filtered rows against the DB (`WorkPackage.name`).
  - **Rule 2 Compliance**: ALL database queries for matching existing WPs will explicitly enforce `deletedAt: null`.
  - Determines:
    - `toCreate`: Rows completely missing from the DB.
    - `toUpdate`: Rows matching an active WP (not Closed/Inactive) where dates have changed.
    - `collisions`: Rows matching a WP that is already "Closed" or "Inactive".
    - `toIgnore`: Rows matching exactly.
- **`executeSync(previewData)`**:
  - **Race Condition Prevention**: Before applying *any* update or creation, re-queries the database (with `deletedAt: null`) to ensure the WP hasn't been modified or closed by another user since the preview was generated.
  - For each `toCreate` / `collisions` (if opted to create new):
    - Determines WP Type based on `TAT` (<=2: PC-EQ, >2: CHECK). Looks up configured `WpBlueprint` ID from `.env`.
    - **Blueprint Architecture Compliance**: Verifies the Blueprint `isActive: true`. Extracts all context fields (`acRegistration`, `customer`, `targetDepartmentId`, etc.) and `autoGenData` exactly as `launchBlueprint` does.
    - Uses `createWorkPackageService` and calls `fireAutoGenForWp`.
  - For each `toUpdate`:
    - **Date Integrity**: Validates `timeframeFrom < timeframeTo`.
    - Updates dates on the WP.
    - **Rule 3 Compliance**: Generates an explicit `AuditLog` entry detailing the date change and attributing it to the sync action.

#### [NEW] `backend/src/controllers/googleSheetSync.controller.ts`
- **`GET /api/sync/preview`**: Returns the diff payload.
- **`POST /api/sync/execute`**: Accepts payload, validates, and executes safely.

#### [MODIFY] `backend/src/routes/googleSheetSync.routes.ts`
- Register endpoints under `/api/sync/`.

---

### Frontend Logic

#### [MODIFY] `frontend/src/app/(dashboard)/master-calendar/page.tsx`
- Add a "SYNC CHECK SCHEDULE" button at the top of the page (restricted to Manager/Director/Admin).
- Opens the `SheetSyncModal`.

#### [NEW] `frontend/src/components/SheetSyncModal.tsx`
- **Preview State**:
  - Displays three lists: "New Work Packages", "Rescheduled Work Packages (To Update)", and "Collisions (Closed WPs with same name)".
  - For Collisions, provides a dropdown/toggle to either "Skip" or "Create New (Appends -REV2)".
  - "Confirm & Sync" button to execute.

---

## Verification Plan

### Automated Tests
- No new unit tests planned, but existing WP and Blueprint creation validations will inherently test the shared service boundaries.

### Manual Verification
- Simulate a rescheduled WP by modifying a date in the sheet and observing the UI flag it as "To Update" and the DB logging an Audit event.
- Simulate a collision by manually setting an existing WP to "Closed" in SQD-APP, adding a row with the same name in the Sheet, and ensuring the UI flags it as a collision.
