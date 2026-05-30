# SQD-APP: Aircraft Maintenance QA System

This project is a full-stack application built for Quality System surveillance, interval audits, and task management.

## Tech Stack
- **Database:** PostgreSQL (with Prisma ORM)
- **Backend:** Node.js, Express, TypeScript
- **Frontend:** Next.js 15 (App Router), React, Tailwind CSS v4, Zustand

## Current Status
- **Phase 5 (Task Management & Work Packages)** is almost complete (Task APIs and Frontend built).
- The `schema.prisma` is actively deployed to local PostgreSQL databases (`sqd_qa_db` and `sqd_qa_test_db`).

## Important Files for Context
If you are an AI assistant starting a new conversation session, please prioritize reading the following files to regain context:
1. `CLAUDE_HANDOVER.md`: This is the **absolute source of truth**. It contains the roadmap, current phase, architecture decisions, and schema logic.
2. `BUSINESS_WORKFLOW.md`: Provides a high-level, human-readable summary of the application workflow and logic rules.
3. `backend/prisma/schema.prisma`: Contains the database architecture, including the complex Findings, AuditLog, and Department/Division hierarchy.
4. `backend/.env`: Contains the local connection strings.
