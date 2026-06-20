---
target: Tasks list page
total_score: 27
p0_count: 0
p1_count: 2
timestamp: 2026-06-20T08-21-18Z
slug: frontend-src-app-dashboard-tasks-page-tsx
---
## Critique: Tasks List Page

**Target**: `frontend/src/app/dashboard/tasks/page.tsx` (+ `TaskStatusBadge.tsx`)

### Assessment B note
Deterministic scan (`detect.mjs`) ran clean — 0 findings, exit 0 — on both files. No browser automation tool was available this session; visual-overlay step skipped.

### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Column-preference save has no success confirmation |
| 2 | Match System / Real World | 4 | Domain terminology fits trained aviation staff throughout |
| 3 | User Control and Freedom | 2 | No undo/confirm on self-assign; tab switch hard-resets all filters |
| 4 | Consistency and Standards | 4 | Strong post-fixes — color vocabulary, dropdown patterns, touch targets consistent |
| 5 | Error Prevention | 2 | Self-assign commits and redirects on a single click with zero confirmation |
| 6 | Recognition Rather Than Recall | 3 | Filters visible; assignee list scoped to current results |
| 7 | Flexibility and Efficiency | 2 | No keyboard shortcuts, bulk actions, or saved filter views |
| 8 | Aesthetic and Minimalist Design | 4 | Dense-but-legible, restrained, true to "The Technical Manual" |
| 9 | Error Recovery | 2 | Fetch failure shows generic toast with no retry path |
| 10 | Help and Documentation | 1 | No help affordance anywhere (mitigated: internal tool, trained staff) |
| **Total** | | **27/40** | **Acceptable** |

### Anti-Patterns Verdict
LLM assessment: Pass, no AI slop tells. Deterministic scan: clean, 0 findings, no disagreement. Visual overlays: skipped (no browser tool available).

### Overall Impression
Visual layer is in good shape after the recent audit/fix cycle. The remaining gap is interaction risk and recovery: self-assign has no confirmation despite being a consequential compliance action, and error recovery is inconsistent between fetch failures (generic) and self-assign failures (specific).

### What's Working
- Color vocabulary now does real work: one severity-tier system spans status and deadline badges.
- Column customization persisted server-side: real flexibility without cluttering the default view.
- Density without chaos: scannable, status-first hierarchy, no decorative noise.

### Priority Issues

**[P1] Self-assign has zero confirmation for an irreversible compliance action**
Why it matters: one click claims the task and redirects immediately, with no undo, in a workflow where wrongly claiming a task creates an audit trail under the user's name.
Fix: inline two-step commit (e.g. "Confirm?" state), not a modal.
Suggested command: /impeccable harden

**[P1] Status filter dropdown presents 9 ungrouped options at once**
Why it matters: exceeds working-memory limits (Cowan's revision of Miller's Law); doesn't reuse the same severity-tier grouping now used for badge colors.
Fix: group checkboxes into Active/Caution/Finding/Clear/Neutral tiers using existing STATUS_CONFIG.
Suggested command: /impeccable layout

**[P2] Fetch failure is a dead end**
Why it matters: generic toast with no retry path, inconsistent with the specific self-assign error handling.
Fix: inline retry state in place of the table.
Suggested command: /impeccable harden

**[P2] Filter state isn't preserved, and tab switching is more destructive than expected**
Why it matters: handleTabChange clears all filters on every tab click, including ones unrelated to the tab; nothing persists across refresh.
Fix: scope resets to what's actually tab-dependent; consider URL query params.
Suggested command: /impeccable harden

### Persona Red Flags

**Alex (Power User)**: No keyboard shortcuts for dropdowns, no bulk self-assign/filter, no saved filter views for repeat daily use.

**Sam (Accessibility)**: Keyboard/ARIA basics hold up well post-fix. Gap: toggling a status checkbox doesn't live-announce the updated selection count.

### Minor Observations
- No clear-button for the date-range filter short of a full tab-switch reset.
- fetchTasks only runs on tab change, not on manual refresh; list can go stale if changed elsewhere.

### Questions to Consider
- Has claiming the wrong task happened in practice, or is this theoretical? Changes whether the fix should add friction or just clearer commit-state feedback.
- Would Directors actually use saved filter combinations, or is usage mostly confined to the three tabs as-is?
