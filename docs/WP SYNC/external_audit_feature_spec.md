# SQD-APP Feature Specification: Google Sheet Schedule Synchronization

**Document Purpose:** This document serves as the comprehensive feature specification for the automated integration of the external Google Sheet maintenance schedule into the SQD-APP Work Package (WP) system. It details the locked design choices, data mapping logic, user experience, and architectural implementation as decided for the initial release, fully compliant with SQD-APP core architecture.

---

## 1. Feature Overview

The Maintenance Control Center (MCC) actively manages aircraft maintenance scheduling via a live Google Sheet. The SQD-APP requires visibility of these scheduled checks to automatically set up the corresponding Quality Assurance / Quality Control (QA/QC) inspection workflows.

This feature enables an **on-demand, manual sync** from the Google Sheet directly into SQD-APP. When triggered, the system fetches the latest schedule, validates it strictly, compares it against existing data, and securely creates or updates Work Packages in the SQD-APP database, complete with automatically generated QA tasks.

---

## 2. Business Logic, Integrity & Compliance

The sync process strictly filters incoming data and adheres to all non-negotiable SQD-APP architectural rules (e.g., Soft Deletes, Audit Logging).

### 2.1 Trigger Scope & Zod Validation
The system processes Google Sheet rows that meet **all** criteria:
1. **Division Alignment:** `Station` column equals `HAN` (QCH) or `SGN` (QCS).
2. **Maintenance Type:** `WP No.` column contains `CHK`.
3. **Status Check:** `WP Status Name` equals `In Preparation`.

> **Data Integrity:** All parsed CSV data is subjected to strict schema validation (using Zod) to ensure dates are valid and required fields are present before any backend processing occurs.

### 2.2 Lifecycle Management & Rescheduling
- **Creation:** A new SQD-APP Work Package is generated when a qualifying row is first detected.
- **Rescheduling (Updates):** If a WP is "Open" or "In Progress" and its schedule changes in the Google Sheet, the sync will detect the mismatch and update `timeframeFrom` and `timeframeTo`. 
  - **Compliance (Rule 3):** Any automated update to a schedule actively generates an `AuditLog` entry in the database.
  - **Data Integrity:** The backend strictly enforces `timeframeFrom < timeframeTo`.
- **Lock-Out:** When a WP reaches the **"Closed"** status in SQD-APP, the WP is locked. Routine syncs will not alter its dates.

### 2.3 Name Collisions & Soft Deletes
- **Compliance (Rule 2):** When checking for existing WPs, the system explicitly enforces `deletedAt: null` to avoid interacting with soft-deleted records.
- **Collisions:** If the Google Sheet contains a `WP No.` that matches an already **Closed** or **Inactive** WP in SQD-APP, this is flagged as a "Collision" in the UI. The user can elect to ignore it or create a distinct new WP (by appending `-REV2` to the name) to guarantee uniqueness.

---

## 3. Data Mapping & Task Generation

### 3.1 Blueprint Selection & Validation
Creating the Work Package triggers the `fireAutoGenForWp` service, spawning tasks from the blueprint's Template Set.

- **Turn-Around Time (TAT) Split:**
  - `TAT` <= 2 days -> **PC-EQ Blueprint**
  - `TAT` > 2 days -> **CHECK Blueprint**
- **Architecture Validation:** The sync engine strictly mirrors the internal `launchBlueprint` controller logic. It verifies `blueprint.isActive === true` and accurately extracts all contextual fields (`acRegistration`, `customer`, `targetDepartmentId`, `autoGenData`) to prevent malformed or orphaned Work Packages.

### 3.2 Field Mapping & Timezones
| Google Sheet Column | SQD-APP Field | Notes |
| :--- | :--- | :--- |
| `WP No.` | `name` | Primary identifier. |
| `WP Desc.` | `description` | Stored as contextual metadata. |
| `Start Date`/`Start Time` | `timeframeFrom` | Combined as UTC timestamp. |
| `End Date`/`End Time` | `timeframeTo` | Combined as UTC timestamp. |

> **Timezone:** PostgreSQL natively stores `DateTime` objects in UTC. Because the Google Sheet timestamp is in UTC, the backend stores it directly as UTC without double-shifting. The frontend automatically localizes presentation.

---

## 4. User Interface & Experience (UI/UX)

### 4.1 Location & Access
A prominent **"SYNC CHECK SCHEDULE"** action button is embedded in `/dashboard/master-calendar` and is strictly restricted to `Manager`, `Director`, and `Admin` roles.

### 4.2 Preview-Then-Confirm Flow & Race Conditions
The sync process is deterministic and requires human confirmation:
1. **Fetch:** User clicks "SYNC CHECK SCHEDULE".
2. **Preview Modal:** Shows diffs across: "New Work Packages", "Rescheduled Work Packages", and "Collisions".
3. **Execution:** User clicks "Confirm & Sync".
   - **Race Condition Prevention:** Immediately before execution, the backend re-queries the database to verify that target WPs haven't been closed or modified by another user in the interim seconds.

### 4.3 Concurrency & Active Work
The sync process only updates the `timeframeFrom` and `timeframeTo` date fields. It does not overwrite tasks or findings. If a user is actively filling out a QA task when a manager executes a sync, their work is **not** disrupted.

---

## 5. Locked Design Choices & Deferred Items

### 5.1 Locked Choices (V1 Implementation)
- **Data Source Ingestion:** Direct Google Sheets CSV export URL (no OAuth).
- **Identifier Strategy:** `WP No.` column is used as the unique name identifier. Collisions are handled via user-reviewed `-REV2` appendment.
- **Blueprint Mapping:** TAT-based mapping is hardcoded via environment variables.

### 5.2 Deferred Items (Future Iterations)
- **Dynamic Configurable Mapping:** Migrating TAT-based mapping to a dynamic Admin configuration table to allow custom regex matching.
- **Blueprint UI Configurator:** Building a full UI to map external check types to internal blueprints.
