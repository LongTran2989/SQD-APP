# SQD-APP Master Implementation Plan

This is a cumulative, living document tracking the technical implementation details of all project phases.

---

## Phase 1: Foundation (COMPLETED)
- **Database:** PostgreSQL modeled via Prisma ORM.
- **Core Entities:** `User`, `Role`, `Department`, `Division`, `Task`, `Template`, `Finding`, `AuditLog`.
- **Infrastructure:** Node.js backend using Express and TypeScript.

---

## Phase 2: Security & Roles (COMPLETED)
- **Authentication:** JWT-based stateless authentication (`/api/auth/login`). Passwords hashed securely using `bcrypt`.
- **Authorization:** Custom Express middleware (`authenticateJWT`, `authorizeRoles`) to restrict endpoints strictly based on user roles (Admin, Director, Manager, Staff).

---

## Phase 3: Frontend Scaffolding (COMPLETED)
- **Framework:** Next.js App Router (React).
- **Styling:** TailwindCSS v4 with a clean, professional Light Theme.
- **State & Networking:** Zustand for client-side state management (persisting JWT) and Axios with automatic header interceptors.

---

## Phase 4.1: Authentication UI & App Shell (COMPLETED)
- **Login Screen:** Fully functional, stylized `/login` gateway natively handling API connections.
- **Protected Layout:** Dashboard layout wrapping children components, dynamically enforcing authentication state via Zustand.
- **Sidebar & Navigation:** Conditionally renders sidebar options based on the authenticated user's `Role`.

---

## Phase 4.2: User Provisioning & Passwords (CURRENTLY EXECUTING)

### Workflow Logic (Approved)
1.  **Account Creation:** Users will never self-register. Accounts are strictly provisioned by Admins/Directors with a temporary password.
2.  **Forced Password Change:** Upon their very first login with the temporary password, the system detects a `forcePasswordChange` flag and rejects normal dashboard entry, instead routing them to a forced update screen.
3.  **Forgot Password:** A flow that generates a secure token. For now, the token will be printed to the backend server console. (In Phase 5, we will hook this up to a real email provider).

### Technical Implementation

#### 1. Schema Modifications (`schema.prisma`)
- Add `forcePasswordChange Boolean @default(true)` to `User`.
- Add `resetPasswordToken String?` and `resetPasswordExpires DateTime?` to `User`.

#### 2. Backend Endpoints (`auth.controller.ts`)
- **Login Modification:** If `forcePasswordChange` is true, login returns a temporary limited-scope JWT and a special `202 Accepted` status instructing the frontend to redirect to `/update-password`.
- **POST `/api/auth/update-password`**: Accepts the temporary JWT and new password, hashes the new password, sets `forcePasswordChange` to `false`, and returns a permanent JWT.
- **POST `/api/auth/forgot-password`**: Finds user by email, generates a secure random hex string, sets expiration (1 hour), saves to DB, and prints to console.
- **POST `/api/auth/reset-password`**: Accepts token and new password, validates expiration, and updates password.

#### 3. Frontend Views
- **`/update-password`**: Form to set a new password, accessible only via the temporary login token.
- **`/forgot-password`**: Public form to request a reset link.
- **`/reset-password`**: Public form accepting a URL token `?token=...` to set a new password.
