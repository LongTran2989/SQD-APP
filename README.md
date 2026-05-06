# SQD-APP: Aircraft Maintenance QA System

This project is a full-stack application built for Quality System surveillance, interval audits, and task management.

## Tech Stack
- **Database:** PostgreSQL (with Prisma ORM)
- **Backend:** Node.js, Express, TypeScript
- **Frontend:** React (Vite) - *To be initialized in Phase 3*

## Current Status
- **Phase 1 (Database & Backend Foundation)** is complete.
- The `schema.prisma` has been deployed to the local PostgreSQL database (`sqd_qa_db`).
- **Next Step:** Phase 2 (Security, JWT Authentication, and RBAC).

## Important Files for Context
If you are an AI assistant starting a new conversation session, please read the following files to regain context:
1. `PROJECT_TRACKER.md`: Contains the roadmap, current phase, and past achievements.
2. `BUSINESS_WORKFLOW.md`: Contains the core business logic, strict Application Workflow rules, Data Visibility (RBAC) constraints, and Findings/Audit rules.
3. `backend/prisma/schema.prisma`: Contains the absolute source of truth for the database architecture, including the complex Findings, AuditLog, and Department/Division hierarchy.
4. `backend/.env`: Contains the local connection strings.
