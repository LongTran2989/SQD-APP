---
target: /dashboard
total_score: 22
p0_count: 1
p1_count: 3
timestamp: 2026-07-01T15-42-32Z
slug: frontend-src-app-dashboard-page-tsx
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Good skeleton loaders throughout, but a failed fetch (`page.tsx` L36-49) leaves permanent skeletons/empty states with only a toast that disappears — no per-widget error state. |
| 2 | Match System / Real World | 3 | Aviation-appropriate terminology used correctly (Work Package, Findings, Pending Verification). |
| 3 | User Control and Freedom | 2 | No dismiss/snooze on `StuckFindingsWidget`; "Advance" has no undo — only a toast after the fact. |
| 4 | Consistency and Standards | 3 | Card chrome is consistent, but `MetricCard` (`text-4xl`) and `DetailedMetricWidget` (`text-3xl`) disagree on type scale for the same "top-level number" role. |
| 5 | Error Prevention | 1 | `StuckFindingsWidget.handleAdvance` (L34-46) mutates finding status with zero confirmation for an aviation compliance action. |
| 6 | Recognition Rather Than Recall | 3 | Icons + color-coded dots aid recognition; breakdown rows are legible without memorization. |
| 7 | Flexibility and Efficiency | 2 | No keyboard shortcuts, no bulk actions, no per-widget refresh — one global refresh button is the only accelerator. |
| 8 | Aesthetic and Minimalist Design | 3 | Palette is restrained and uncluttered, but the page is visually homogeneous — every section is a rounded white card with no anchor for what matters most. |
| 9 | Error Recovery | 1 | Generic toast ("Failed to load dashboard data") with no retry action and no distinction between network failure and empty data. |
| 10 | Help and Documentation | 1 | No inline help or tooltips anywhere except a single `title` attribute on the refresh button. |
| **Total** | | **22/40** | **Acceptable — significant improvements needed** |

#### Anti-Patterns Verdict

**Start here.** Does this look AI-generated?

**LLM assessment**: Not AI-slop in the gradient-text/emoji/glassmorphism sense — no absolute-ban violations found. But it is a generic "SaaS dashboard template": three metric cards up top, activity feed on the right, progress-bar list on the left. That's the real problem against this project's own brand brief. PRODUCT.md explicitly bans "consumer SaaS (Notion, Linear, Figma)... whitespace-as-personality" as an anti-reference, yet `EscalationWidget`'s 4xl extrabold red count and `MetricCard`'s 4xl bold numbers on soft pastel icon chips (`bg-amber-50`, `bg-blue-50`, `shadow-sm`, `rounded-xl` everywhere) are exactly the Stripe/Linear metrics-card template this system is supposed to differentiate from. Nothing here signals "military-grade authority through restraint" — it signals subscription-analytics dashboard.

**Deterministic scan**: `detect.mjs --json` against `frontend/src/app/dashboard/page.tsx` and `frontend/src/components/dashboard/` exited 0 with an empty findings array — clean, no rule violations (no side-stripe borders, no gradient text, no other scanned slop patterns detected). This is a real, current result: the detector genuinely found nothing, which reinforces that the issue here is systemic/holistic (template sameness, hierarchy, error handling) rather than any single flagged anti-pattern the deterministic rules catch.

**Visual overlays**: Not available this run — no browser/screenshot tool was exposed to either sub-agent, so no live page inspection, no console evidence, and no user-visible overlay was produced. This critique is based on source-code review only for the design assessment, and CLI-only for the detector; treat findings that would require live rendering (actual contrast values, real data density, animation feel) as unverified.

#### Overall Impression

The dashboard is competent and safe but generically templated. Loading states, empty states, and the escalation zero-state pattern are genuinely well done. The core problem is twofold: (1) it visually reads as a stock SaaS analytics dashboard, which directly contradicts this project's own "not consumer SaaS" anti-reference, and (2) for a compliance tool, error prevention and recovery are the weakest heuristics (1/4 each) — a single unconfirmed click can advance a finding's compliance status, and a failed data load has no way back short of a full page refresh. The biggest opportunity: make the "Advance" action safe, and make the top of the page look like an operations command surface, not a metrics-SaaS landing screen.

#### What's Working

- **`EscalationWidget`'s zero-state** (emerald checkmark + "No pending escalations") inverts the alarm color into calm confirmation — a good reassurance pattern that should be replicated elsewhere (`StuckFindingsWidget` instead just renders `null` when clear, missing the same win).
- **Work package progress-bar color banding** (amber → blue → blue → emerald by completion threshold in `WorkPackageWidget`) gives at-a-glance status without reading numbers, which matches the stated "zero ambiguity on status" design principle well.
- **`aria-live="polite"` + `role="status"`** on `EscalationWidget` is a real accessibility investment most teams skip at this stage.

#### Priority Issues

- **[P0] Unconfirmed compliance-state mutation**: `StuckFindingsWidget`'s "Advance" button (`StuckFindingsWidget.tsx` L77-85) advances a finding to Pending Verification on a single click with no confirmation and no undo — only a toast after the fact.
  **Why it matters**: This is an aviation QA tool; every status change is subject to the dual-audit rule (AuditLog + TaskActivity) precisely because these actions carry compliance weight. A misclick here is not equivalent to a misclick in a consumer app.
  **Fix**: Add a lightweight confirm step (inline "Are you sure?" swap or a small confirm popover) before the mutation fires; keep it one extra click, not a full modal.
  **Suggested command**: `/impeccable harden`

- **[P1] No recovery path on load failure**: `fetchData` (`page.tsx` L36-49) shows a toast on failure but the toast disappears and the widget stays in its skeleton/empty state forever, with no retry affordance.
  **Why it matters**: Directors and Managers rely on this page for real-time operational visibility; a silent stuck skeleton after a transient network blip erodes trust in the data with no way to recover except a full page reload.
  **Fix**: Give each of the three data regions (summary, WPs, feed) its own inline error state with a "Retry" button, not just a global toast.
  **Suggested command**: `/impeccable harden`

- **[P1] Generic SaaS-template feel contradicts the brand's own anti-reference**: The page structure (hero metric cards + activity feed sidebar + progress-bar list) and materials (soft pastel icon chips, `shadow-sm`, `rounded-xl` on every surface) read as a Linear/Stripe dashboard clone, which PRODUCT.md explicitly lists as an anti-reference ("no consumer SaaS... whitespace-as-personality").
  **Why it matters**: The brand brief wants "authority through restraint" and "military-grade... without ops-room theatrics" — a look distinct from consumer SaaS. Right now a user couldn't tell this apart from a generic admin template if you swapped the labels.
  **Fix**: Differentiate the visual language — e.g., flatten the pastel icon chips into the status-color system already defined in DESIGN.md (signal-blue/amber/red/emerald surfaces), tighten card padding for the "data density with room to breathe" principle, and give the escalation/findings-needing-attention area a structurally distinct treatment (not just another rounded white/tinted card) so it reads as command-surface, not dashboard-widget.
  **Suggested command**: `/impeccable typeset` or `/impeccable layout`

- **[P1] Breakdown list breaks the ≤4 chunking rule and buries the most urgent row**: `DetailedMetricWidget`'s "Pending Tasks" breakdown (`page.tsx` L117-123) has 5 rows (Unassigned, Due Today, Overdue, In Review, Pending Rating), and "Overdue" — the truly urgent one — sits at position 3, not promoted.
  **Why it matters**: Violates the working-memory ≤4-items rule and this project's own "zero ambiguity on status" principle; overdue items are the ones with the most safety/compliance consequence and shouldn't be visually equal to "Pending Rating."
  **Fix**: Pull "Overdue" out as its own top-line stat (or lead the breakdown with it, visually emphasized), cap the visible breakdown rows at 4.
  **Suggested command**: `/impeccable layout`

- **[P2] Feed scroll affordance is invisible**: `ActivityFeedWidget`'s `[mask-image:linear-gradient(...)]` fade (L20) signals "more content" only via a fade, with no visible scrollbar or "load more" cue.
  **Why it matters**: Users can miss that more activity exists below the fold, especially the Jordan (first-timer) persona who won't know to scroll a fading region.
  **Fix**: Add a visible thin scrollbar or a "Load more" affordance at the fade boundary.
  **Suggested command**: `/impeccable clarify`

#### Persona Red Flags

**Sam (Accessibility-Dependent)**: Every section header in the widgets is rendered as a plain `h2` (`EscalationWidget`, `StuckFindingsWidget`, `ActivityFeedWidget`, `WorkPackageWidget` all use `<h2>` with no landmark differentiation) — a screen reader user tabbing through gets an undifferentiated flat list of "h2, h2, h2, h2" with no way to distinguish "this is an alert region" from "this is a list." The "Advance" button and "Review" link also carry no `aria-describedby` explaining the consequence of the action, which is a meaningful gap given the P0 above involves an irreversible-feeling compliance mutation.

**Alex (Power User)**: One global refresh button (`QuickActionBar.tsx` L18-26) is the only accelerator on the entire page — no per-widget refresh, no auto-poll, no keyboard shortcuts. A Director triaging escalations mid-shift must reload the entire dashboard (summary + WPs + feed) to see one new escalation come in.

**Riley (Stress Tester)**: Neither `WorkPackageWidget` nor `StuckFindingsWidget` cap or paginate their lists — both rely on a fixed-height scroll container (`max-h-[350px]` / `max-h-[400px]`) with no virtualization or "load more." With a large division, both become unpaginated scroll wells; `StuckFindingsWidget` in particular has no per-item loading/error isolation, so one failed advance call state isn't obviously separated from the rest of the list.

#### Minor Observations

- Two separate places compute `isManagerOrDirector` independently (`page.tsx` L56 and `QuickActionBar.tsx` L13) — a drift risk if role logic changes in only one place.
- Date formatting is inconsistent across the page: header uses full weekday `en-GB` long format, feed uses `month: short, day, hour:minute` — no shared date-formatting utility.
- Staff-role `MetricCard` subtitle "Available in division" on Unassigned Tasks slightly overpromises self-assignability versus just being a count.
- Detector scan was clean (0 findings) — this critique's issues are structural/holistic rather than pattern-violations the automated scanner catches, which is expected for a mature codebase; don't read the clean scan as "nothing to fix."

#### Questions to Consider

- Is a "hero metrics + feed" SaaS-template layout actually right for a tool whose own brand brief anti-references consumer SaaS, or should the Director's first screen look categorically different from a Stripe/Linear dashboard?
- Why does "Advance" on a stuck finding — a compliance state mutation — get less friction than deleting a comment would in most apps?
- Should escalation/red content ever be the very first thing a user sees on login, or should the page open on a calm status summary with alerts one section down?
