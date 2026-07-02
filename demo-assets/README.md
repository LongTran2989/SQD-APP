# SQD-APP Demonstration Assets

A self-contained slide deck for demonstrating SQD-APP to a mixed Staff / Manager / Director audience.

## Files
- **`SQD-APP-Demo.html`** — the deck. Open in any browser; navigate with **← / →** (or Space), **F** for fullscreen. Fully offline (no CDN dependencies).
- **`screens/`** — 18 real UI screenshots captured live from the running app against the demo seed (`backend/prisma/seed-mass-mockup-v2.ts`), one login per role.

## Contents (18 slides)
1. Title · 2. Purpose & "Technical Manual" aesthetic · 3. Tech stack · 4. ERD (Task hub + Finding cluster) · 5. Schema & immutability guarantees · 6. RBAC (view-transparent, action-scoped) · 7. Lifecycle overview · 8. Manager: WP + auto-gen · 9. Template Sets & Blueprints · 10. Staff: task pool · 11. Staff: execution form · 12. Findings · 13. **RCA/CAPA** · 14. **Escalation loop** · 15. Time booking & review · 16. Analytics · 17. Per-role workflow summary · 18. Close.

## Demo accounts
Password `Demo@12345` (set for the demo; seeded users otherwise force a password change on first login):
- Director — `VAE00071`
- Manager (QA) — `VAE00061`
- Staff (QA) — `VAE00051`

## Regenerating screenshots
Screenshots were captured with Playwright driving Chromium against `localhost:3000` (frontend) + `localhost:5000` (backend), viewport 1440×900 @2×, full-page. Set `DISABLE_RATE_LIMIT=true` in `backend/.env` first (the login rate limiter otherwise blocks rapid multi-role logins), and drive login by typing (not `fill`) to avoid a React state race.
