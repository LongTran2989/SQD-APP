# SQD-APP Demonstration Assets

A self-contained slide deck for demonstrating SQD-APP to a mixed Staff / Manager / Director audience.

## Files
- **`SQD-APP-Demo.html`** — the deck (22 slides). Open in any browser; navigate with **← / →** (or Space), **F** for fullscreen. Fully offline (no CDN dependencies).
- **`SQD-APP-Demo.pptx`** — the **editable PowerPoint** version of the same deck: native text boxes, a real RBAC table, the ERD as editable shapes, and the screenshots/flowcharts embedded as pictures. Opens in PowerPoint / Keynote / Google Slides.
- **`build_pptx.py`** — regenerates the PPTX from the screenshots + flowcharts (`python3 build_pptx.py`; needs `python-pptx`).
- **`screens/`** — 17 real UI screenshots captured live from the running app against the demo seed (`backend/prisma/seed-mass-mockup-v2.ts`), one login per role.
- **`workflow-swimlane.mmd` / `.png`** — Mermaid source + rendered **full** swimlane of the task lifecycle across System / Staff / Manager / Director lanes (all cases connected — kept as the reference view).
- **`case-a-standard` · `case-b-finding` · `case-c-review` · `case-d-wp-origination` (`.mmd` / `.png`)** — the full swimlane split into four **focused, per-case** swimlanes for cleaner individual slides: (A) standard task no finding, (B) task-raises-finding corrective loop, (C) review outcomes & interventions, (D) WP setup & task origination.
- **`workflow-escalation.mmd` / `.png`** — Mermaid source + rendered swimlane of the **Unified Feed & Escalation** loop.
- **`../RBAC_RULES.md`** — the complete, code-verified list of every RBAC rule (roles, division scope, the multi-division WP case, review/finding/escalation gates).

Regenerate the flowcharts: `mmdc -i workflow-swimlane.mmd -o workflow-swimlane.png -b white -s 2 -w 2400` (mermaid-cli; point Puppeteer at the pre-installed Chromium).

## Contents (26 slides)
1. Title · 2. Purpose & "Technical Manual" aesthetic · 3. Tech stack · 4. ERD (Task hub + Finding cluster) · 5. Schema & immutability guarantees · 6. RBAC (view-transparent, action-scoped) · 7. Lifecycle overview · 8. Manager: WP + auto-gen · 9. Template Sets & Blueprints · 10. Staff: task pool · 11. Staff: execution form · 12. Findings · 13. **RCA/CAPA** · 14. **Escalation loop** · 15. Time booking & review · 16. Analytics · 17. Per-role workflow summary · 18. **Swimlane: full task lifecycle (reference)** · 19. **Case A: standard task** · 20. **Case B: with finding** · 21. **Case C: review outcomes** · 22. **Case D: WP setup** · 23. **Swimlane: escalation** · 24. RBAC key rules · 25. **Live-demo runbook (click paths)** · 26. Close.

## Demo accounts
Password `Demo@12345` (set for the demo; seeded users otherwise force a password change on first login):
- Director — `VAE00071`
- Manager (QA) — `VAE00061`
- Staff (QA) — `VAE00051`

## Regenerating screenshots
Screenshots were captured with Playwright driving Chromium against `localhost:3000` (frontend) + `localhost:5000` (backend), viewport 1440×900 @2×, full-page. Set `DISABLE_RATE_LIMIT=true` in `backend/.env` first (the login rate limiter otherwise blocks rapid multi-role logins), and drive login by typing (not `fill`) to avoid a React state race.
