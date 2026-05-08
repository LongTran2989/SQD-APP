# Project Tracker: Aviation Maintenance QA App

This document serves as the persistent log for our project. It tracks what we are working on, what we have achieved, and our future plans.

## Current Status
- **Phase:** Phase 4 (Core Features)
- **Current Task:** Phase 4.3 (Template Builder) Completed. Moving to Task Assignment.

---

## Milestones & Roadmap

### [x] Phase 1: Foundation (Backend & Database)
- [x] Define Workflow and Database Schema (Pending User Approval)
- [x] Initialize Node.js & Express Backend
- [x] Connect backend to local PostgreSQL using Prisma ORM
- [x] Generate and migrate the database schema

### [x] Phase 2: Security & Roles
- [x] Implement JWT Authentication (Login/Register)
- [x] Implement Role-Based Access Control (RBAC) middleware

### [x] Phase 3: Frontend Scaffolding
- [x] Initialize Next.js application
- [x] Set up routing and basic UI layout/navigation

### [/] Phase 4: Core Features
- [x] Build Template Builder UI and Backend API
- [ ] Build Task Assignment UI and Backend API
- [ ] Build Task Execution interface for Staff
- [ ] Build Review/Approval dashboard for Managers

### [ ] Phase 5: Reporting & Deployment
- [ ] Build basic reporting dashboard
- [ ] Dockerize application
- [ ] Prepare deployment instructions for VPS

---

## Achievements
*   *2026-05-06:* Project initialized. Git repository created. `.gitignore` set up. Architecture stack (Node, Next.js, PostgreSQL) agreed upon.
*   *2026-05-06:* Refined Workflow and Database Schema to support Quality System requirements (Findings system, JSON-based branching templates, complex User authorizations).
*   *2026-05-06:* Finalized Architecture to include immutable `AuditLog` tracking and strict Data Visibility (RBAC) filtering rules.
*   *2026-05-06:* Added Department/Division hierarchy for external audit metrics, and hierarchical task assignment/transfer capabilities.
*   *2026-05-06:* Completed Phase 1 & 2. Implemented automated Jest test suite for security endpoints.
*   *2026-05-07:* Completed Phase 3. Scaffolded Next.js App Router frontend with Tailwind v4, Zustand, and Axios.
*   *2026-05-08:* Completed Phase 4.3 (Template Builder). Built visual form builder UI, dynamic data source API, and template CRUD.
*   *2026-05-08:* Major schema overhaul: Division codes, template auto-ID generation (QA-001), pessimistic locking, revision archiving, AircraftType IATA/ICAO redesign, AircraftRegistration model. Seeded 11 users, 4 divisions, 4 aircraft types, 5 registrations.
