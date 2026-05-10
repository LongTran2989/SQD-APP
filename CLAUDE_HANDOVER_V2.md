# CLAUDE_HANDOVER_V2.md

## SECTION 1: PROJECT STRUCTURE

### /backend
```
C:\SQD-APP\backend
|   .env
|   .env.test
|   backend_tree.txt
|   frontend_tree.txt
|   jest.config.js
|   package-lock.json
|   package.json
|   prisma.config.ts
|   tsconfig.json
|   
+---prisma
|       schema.prisma
|       seed.ts
|       
\---src
    |   index.ts
    |   
    +---controllers
    |       auth.controller.ts
    |       datasource.controller.ts
    |       template.controller.ts
    |       user.controller.ts
    |       
    +---middleware
    |       auth.middleware.ts
    |       rbac.middleware.ts
    |       
    +---routes
    |       auth.routes.ts
    |       datasource.routes.ts
    |       template.routes.ts
    |       user.routes.ts
    |       
    \---__tests__
            auth.test.ts
            features.test.ts
            health.test.ts
            setup.ts
            user.test.ts
```

### /frontend
```
C:\SQD-APP\frontend
|   .env
|   .gitignore
|   eslint.config.mjs
|   next-env.d.ts
|   next.config.ts
|   package-lock.json
|   package.json
|   postcss.config.mjs
|   README.md
|   tsconfig.json
|   
+---public
|       file.svg
|       globe.svg
|       next.svg
|       vercel.svg
|       window.svg
|       
\---src
    +---api
    |       client.ts
    |       
    +---app
    |   |   favicon.ico
    |   |   globals.css
    |   |   layout.tsx
    |   |   page.tsx
    |   |   
    |   +---dashboard
    |   |   |   layout.tsx
    |   |   |   page.tsx
    |   |   |   
    |   |   \---templates
    |   |       |   page.tsx
    |   |       |   
    |   |       +---new
    |   |       |       page.tsx
    |   |       |       
    |   |       \---[id]
    |   |               page.tsx
    |   |               
    |   +---forgot-password
    |   |       page.tsx
    |   |       
    |   +---login
    |   |       page.tsx
    |   |       
    |   +---reset-password
    |   |       page.tsx
    |   |       
    |   \---update-password
    |           page.tsx
    |           
    +---components
    |   +---layout
    |   |       Header.tsx
    |   |       Sidebar.tsx
    |   |       
    |   \---templates
    |           RevisionHistoryPanel.tsx
    |           
    +---store
    |       authStore.ts
    |       
    \---types
            index.ts
```

## SECTION 2: DATABASE SCHEMA

```prisma
generator client {
  provider = "prisma-client-js"
  engineType = "library"
}

datasource db {
  provider = "postgresql"
}

// -----------------------------------------------------------------------
// Organization Hierarchy
// -----------------------------------------------------------------------

model Department {
  id             Int        @id @default(autoincrement())
  name           String     @unique
  divisions      Division[]
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
}

model Division {
  id             Int        @id @default(autoincrement())
  name           String
  code           String     @unique // e.g. QA, QCH, QCS, SQ — used for templateId generation
  departmentId   Int
  department     Department @relation(fields: [departmentId], references: [id])
  users          User[]
  templates      Template[] @relation("TemplateDivision")
  targetedTasks  Task[]     @relation("TaskTargetDivision")
  targetedFinds  Finding[]  @relation("FindingTargetDivision")
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
}

// -----------------------------------------------------------------------
// User & Roles
// -----------------------------------------------------------------------

model Role {
  id             Int        @id @default(autoincrement())
  name           String     @unique // e.g. Director, Manager, Group Leader, Staff
  users          User[]
}

model User {
  id                 Int        @id @default(autoincrement())
  name               String
  email              String     @unique
  passwordHash       String
  forcePasswordChange Boolean   @default(true)
  resetPasswordToken  String?
  resetPasswordExpires DateTime?
  
  divisionId         Int
  division           Division   @relation(fields: [divisionId], references: [id])
  
  roleId             Int
  role               Role       @relation(fields: [roleId], references: [id])
  
  assignedTasks      Task[]     @relation("TaskAssignedTo")
  reportedFindings   Finding[]  @relation("FindingReportedBy")
  
  // Templates this user revised or locked
  revisedTemplates       Template[]               @relation("TemplateRevisedBy")
  lockedTemplates        Template[]               @relation("TemplateLockedBy")
  revisionArchives       TemplateRevisionArchive[] @relation("ArchiveRevisedBy")
  
  aircraftAuths      UserAircraftAuthorization[]
  jobAuths           UserJobAuthorization[]
  
  createdAt          DateTime   @default(now())
  updatedAt          DateTime   @updatedAt
}

// -----------------------------------------------------------------------
// Aircraft (Authorization + Registration)
// -----------------------------------------------------------------------

model AircraftType {
  id             Int        @id @default(autoincrement())
  iataCode       String     @unique // e.g. 737, 320
  icaoCode       String     @unique // e.g. B737, A320
  manufacturer   String                // e.g. Boeing, Airbus
  model          String                // e.g. 737-800, A320neo
  registrations  AircraftRegistration[]
  authorizations UserAircraftAuthorization[]
  createdAt      DateTime   @default(now())
}

model AircraftRegistration {
  id             Int          @id @default(autoincrement())
  registration   String       @unique  // e.g. VN-A361
  operator       String                // e.g. Vietnam Airlines
  authority      String                // e.g. CAAV
  aircraftTypeId Int
  aircraftType   AircraftType @relation(fields: [aircraftTypeId], references: [id])
  createdAt      DateTime     @default(now())
}

model UserAircraftAuthorization {
  id             Int        @id @default(autoincrement())
  userId         Int
  user           User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  aircraftTypeId Int
  aircraftType   AircraftType @relation(fields: [aircraftTypeId], references: [id], onDelete: Cascade)

  @@unique([userId, aircraftTypeId])
}

model AuthorizationType {
  id             Int        @id @default(autoincrement())
  code           String     @unique // e.g. INSPECTOR, MECHANIC
  description    String?
  authorizations UserJobAuthorization[]
}

model UserJobAuthorization {
  id                   Int        @id @default(autoincrement())
  userId               Int
  user                 User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  authorizationTypeId  Int
  authorizationType    AuthorizationType @relation(fields: [authorizationTypeId], references: [id], onDelete: Cascade)

  @@unique([userId, authorizationTypeId])
}

// -----------------------------------------------------------------------
// Templates & Tasks
// -----------------------------------------------------------------------

model Template {
  id               Int        @id @default(autoincrement())
  templateId       String     @unique // Auto-generated: [DivisionCode]-[3-digit seq], e.g. QA-001
  title            String
  description      String?
  status           String     @default("Draft") // Draft, Published, Archived
  revision         Int        @default(1)
  requiresApproval Boolean    @default(false)
  allowsFindings   Boolean    @default(true)
  formSchema       Json       // JSON document for field definitions
  
  // Division ownership (determines templateId prefix)
  divisionId       Int
  division         Division   @relation("TemplateDivision", fields: [divisionId], references: [id])
  
  // Revision tracking
  revisedByUserId  Int?
  revisedByUser    User?      @relation("TemplateRevisedBy", fields: [revisedByUserId], references: [id])
  revisedAt        DateTime?
  
  // Pessimistic locking (lock is valid if lockedAt is within last 30 minutes)
  lockedByUserId   Int?
  lockedByUser     User?      @relation("TemplateLockedBy", fields: [lockedByUserId], references: [id])
  lockedAt         DateTime?
  
  tasks            Task[]
  revisionArchives TemplateRevisionArchive[]
  
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt
  publishedAt      DateTime?
}

model TemplateRevisionArchive {
  id               Int        @id @default(autoincrement())
  templateId       Int
  template         Template   @relation(fields: [templateId], references: [id], onDelete: Cascade)
  revision         Int
  formSchema       Json       // Snapshot of the formSchema at this revision
  publishedAt      DateTime
  
  revisedByUserId  Int
  revisedByUser    User       @relation("ArchiveRevisedBy", fields: [revisedByUserId], references: [id])
  
  createdAt        DateTime   @default(now())
}

model Task {
  id                 Int        @id @default(autoincrement())
  templateId         Int
  template           Template   @relation(fields: [templateId], references: [id])
  
  status             String     @default("Assigned") // Assigned, InProgress, Review, Approved, Rejected
  
  assignedToUserId   Int?
  assignedToUser     User?      @relation("TaskAssignedTo", fields: [assignedToUserId], references: [id])
  
  // The division being audited/surveilled
  targetDivisionId   Int?
  targetDivision     Division?  @relation("TaskTargetDivision", fields: [targetDivisionId], references: [id])
  
  // If this task is a follow-up action to a finding
  parentFindingId    Int?
  parentFinding      Finding?   @relation("FindingFollowUpTask", fields: [parentFindingId], references: [id])
  
  taskData           TaskData?
  sourceFindings     Finding[]  @relation("FindingSourceTask")
  
  createdAt          DateTime   @default(now())
  completedAt        DateTime?
  updatedAt          DateTime   @updatedAt
}

model TaskData {
  id                 Int        @id @default(autoincrement())
  taskId             Int        @unique
  task               Task       @relation(fields: [taskId], references: [id], onDelete: Cascade)
  data               Json       // The actual answers/inputs matching formSchema
  
  createdAt          DateTime   @default(now())
  updatedAt          DateTime   @updatedAt
}

// -----------------------------------------------------------------------
// Findings System
// -----------------------------------------------------------------------

model Finding {
  id                 Int        @id @default(autoincrement())
  severity           String     // Low, Medium, High, Critical
  category           String     // Safety, Documentation, Tools, etc.
  description        String
  status             String     @default("Open") // Open, Closed
  
  sourceTaskId       Int?
  sourceTask         Task?      @relation("FindingSourceTask", fields: [sourceTaskId], references: [id])
  
  reportedByUserId   Int
  reportedByUser     User       @relation("FindingReportedBy", fields: [reportedByUserId], references: [id])
  
  targetDivisionId   Int?
  targetDivision     Division?  @relation("FindingTargetDivision", fields: [targetDivisionId], references: [id])
  
  followUpTasks      Task[]     @relation("FindingFollowUpTask")
  
  createdAt          DateTime   @default(now())
  closedAt           DateTime?
  updatedAt          DateTime   @updatedAt
}

// -----------------------------------------------------------------------
// Audit & Accountability
// -----------------------------------------------------------------------

model AuditLog {
  id                 Int        @id @default(autoincrement())
  actionType         String     // TASK_REASSIGNED, TASK_REJECTED, FINDING_RAISED, etc.
  entityType         String     // Task, Finding
  entityId           Int        
  
  performedByUserId  Int
  
  comment            String?    // User's reasoning or feedback
  details            Json?      // Technical JSON payload of the change
  
  timestamp          DateTime   @default(now())
}
```

## SECTION 3: BACKEND API SURFACE

### auth.routes.ts
- `POST /login` -> `login` (No middleware)
- `POST /register` -> `register` (authenticateJWT, authorizeRoles('Director', 'Admin'))
- `POST /update-password` -> `updatePassword` (authenticateJWT)
- `POST /forgot-password` -> `forgotPassword` (No middleware)
- `POST /reset-password` -> `resetPassword` (No middleware)

### datasource.routes.ts
- `GET /:source` -> `getDataSource` (authenticateJWT)

### template.routes.ts
- `GET /` -> `getTemplates` (authenticateJWT)
- `GET /:id` -> `getTemplateById` (authenticateJWT)
- `POST /` -> `createTemplate` (authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'))
- `PUT /:id` -> `updateTemplate` (authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'))
- `DELETE /:id` -> `deleteTemplate` (authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'))
- `POST /:id/publish` -> `publishTemplate` (authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'))
- `POST /:id/lock` -> `lockTemplate` (authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'))
- `POST /:id/unlock` -> `unlockTemplate` (authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'))

### user.routes.ts
- `PUT /:id/role` -> `updateUserRole` (authenticateJWT, authorizeRoles('Admin'))

## SECTION 4: BACKEND CONTROLLERS SUMMARY

### auth.controller.ts
- `login`: Validates credentials, returns JWT. (User, Role)
- `register`: Creates new user account. (User, Role)
- `updatePassword`: Updates password for authenticated user. (User)
- `forgotPassword`: Generates reset token. (User)
- `resetPassword`: Resets password using token. (User)

### datasource.controller.ts
- `getDataSource`: Fetches options for dynamic dropdowns (divisions, aircrafts, etc). (Division, Department, User, AircraftType)

### template.controller.ts
- `getTemplates`: Lists all templates with lock/revisor info. (Template)
- `getTemplateById`: Fetches single template with archives. (Template, TemplateRevisionArchive)
- `createTemplate`: Atomically generates templateId and creates record. (Template, Division)
- `updateTemplate`: Updates template metadata/schema, checks lock. (Template)
- `publishTemplate`: Bumps revision, creates archive snapshot, releases lock. (Template, TemplateRevisionArchive)
- `lockTemplate`: Sets pessimistic lock if available or expired. (Template)
- `unlockTemplate`: Releases lock for owner or privileged user. (Template)
- `deleteTemplate`: Deletes or archives template if in use. (Template, Task)

### user.controller.ts
- `updateUserRole`: Updates a user's RBAC role. (User, Role)

## SECTION 5: FRONTEND ROUTE MAP

- `/` (`page.tsx`): Root landing or redirect.
- `/login` (`page.tsx`): User login.
- `/forgot-password` (`page.tsx`): Request password reset.
- `/reset-password` (`page.tsx`): Set new password with token.
- `/update-password` (`page.tsx`): Change password after first login.
- `/dashboard` (`page.tsx`): Main entry point for authenticated users.
- `/dashboard/templates` (`page.tsx`): List of all templates. Calls `GET /api/templates`.
- `/dashboard/templates/new` (`page.tsx`): Form builder to create new template. Calls `POST /api/templates`.
- `/dashboard/templates/[id]` (`page.tsx`): Template editor. Calls `GET /api/templates/:id`, `POST /lock`, `POST /unlock`, `POST /publish`, `GET /revisions`.

## SECTION 6: FRONTEND COMPONENTS

- `Header` (`components/layout/Header.tsx`): Top nav bar with user profile.
- `Sidebar` (`components/layout/Sidebar.tsx`): Side navigation with RBAC link filtering.
- `RevisionHistoryPanel` (`components/templates/RevisionHistoryPanel.tsx`): Slide-over for viewing published snapshots.

## SECTION 7: TYPES & INTERFACES

```typescript
export interface Role {
  id: number;
  name: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: string; // The backend returns the role name as a string
  divisionId: number | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export type FieldType = 'text' | 'number' | 'select' | 'checkbox' | 'textarea';
export type DataSource = 'custom' | 'departments' | 'divisions' | 'users' | 'aircrafts';

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  placeholder?: string;
  dataSource?: DataSource;
  options?: string[];
}

export interface Template {
  id: number;
  title: string;
  description: string | null;
  status: 'Draft' | 'Published' | 'Archived';
  templateId: string;
  revision: number;
  revisedBy?: { name: string } | null;
  revisedAt?: string | null;
  requiresApproval: boolean;
  allowsFindings: boolean;
  formSchema: FormField[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}
```

## SECTION 8: ZUSTAND STORES

### useAuthStore (`store/authStore.ts`)
- `user`: `User | null`
- `token`: `string | null`
- `isAuthenticated`: `boolean`
- `login(user, token)`: Sets state and persists to local storage.
- `logout()`: Clears state and storage.

## SECTION 9: ENVIRONMENT & CONFIG

### Backend (.env)
- `DATABASE_URL`: Prisma connection string for PostgreSQL.
- `PORT`: Server port (default 5000).
- `JWT_SECRET`: Key for signing JWT tokens.

### Frontend
- `NEXT_PUBLIC_API_URL`: Base URL for the backend API.

## SECTION 10: CURRENT IMPLEMENTATION STATUS

| Feature | Status | Notes |
|---------|--------|-------|
| Auth & JWT | ✅ Done | Login, token persistence, and middleware in place. |
| RBAC Middleware | ✅ Done | `authorizeRoles` implemented and applied to routes. |
| Template CRUD | ✅ Done | Full lifecycle implemented. |
| Template ID Generation | ✅ Done | Auto-generation logic in `createTemplate`. |
| Pessimistic Locking | ✅ Done | Backend logic and frontend UI banner implemented. |
| Publish & Archiving | ✅ Done | Archiving snapshots on publish implemented. |
| Revision History Endpoint | ❌ Missing | **BUG**: `GET /api/templates/:id/revisions` route not registered in routes file. |
| Aircraft Tables | ✅ Done | Tables present and seeded. |
| Division Seed | ⚠️ Partial | **BUG**: Missing `QCS` and `SQ` in test DB setup. |
| User Seed | ✅ Done | 11 mock accounts in `prisma/seed.ts`. |
| Form Builder UI | ✅ Done | Drag/drop-like field management implemented. |
| Template List UI | ✅ Done | Responsive layout with status badges. |
| Template Edit UI | ✅ Done | Comprehensive editor with revision tracking. |
| Unsaved Changes Tracking | ✅ Done | `isDirty` state and navigation interception modal. |
| Lock Banner UI | ✅ Done | Amber warning banner and read-only mode states. |
| Revision History UI | ✅ Done | Slide-over panel component exists. |
| User Management Pages | ❌ Pending | Sidebar links exist but pages 404. |
| Settings Pages | ❌ Pending | Sidebar links exist but pages 404. |

## SECTION 11: KNOWN BUGS (UNRESOLVED)

1. **Race Condition in Template ID Generation**: Concurrent `POST /api/templates` can generate duplicate templateIds. Needs `FOR UPDATE` locking or retry logic.
2. **Test DB Seed Missing**: `sqd_qa_test_db` not seeded automatically in integration tests.
3. **Division Seed Incomplete**: `QCS` and `SQ` missing from test division setup.
4. **Hydration Mismatch**: React error on Login page due to server/client mismatch.
5. **UI Metadata Missing**: Template List cards lack ID and Division badges.
6. **Publish Button Broken**: Frontend `handleSave` via `PUT` doesn't update status or call archiving logic.
7. **Missing Endpoint**: `GET /api/templates/:id/revisions` backend route is not registered.
8. **Checkbox Icon Bug**: Checkmark does not render when toggled in form builder.
9. **Redirect Bug**: "Save as Draft" redirects to List instead of staying in Editor.

## SECTION 12: GIT STATUS

### Last 10 Commits
```
c1b8fe4 feat: add revision history slide-over panel to template edit page
67359ad feat: show templateId, revision badges and revision metadata in edit page top bar
efadf8c feat: add pessimistic lock handling to template edit page
b660fa7 feat: add unsaved changes tracking and modal to template edit page
0bfa684 test: fix auth tests by setting forcePasswordChange to false
05b1d1f feat: schema overhaul with locking, revisions, and full seed data
f4e2748 feat: complete Phase 4.3 Template Builder with dynamic data sources
389eb7b fix: resolve sidebar role check bug and template controller type errors
7b09308 feat: complete phase 3 and 4 authentication UI, app shell, and password flows
2bd6c0e test: implement backend test suite and test db configuration
```

### Current Status
```
On branch main
Your branch is up to date with 'origin/main'.

Untracked files:
	backend_tree.txt
	frontend_tree.txt
```
