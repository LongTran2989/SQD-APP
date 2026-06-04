// Roles with an actionable escalation queue (the bell badge, the Escalations
// page, and the Sidebar nav item all gate on this). Mirrors the backend
// canActionFlag role gate, which remains the authority — the UI list is a
// convenience so a single edit keeps Header / page / Sidebar in sync.
export const ESCALATION_ACTION_ROLES = ['Director', 'Admin', 'Manager'];
