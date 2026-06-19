---
name: SQD-APP
description: Aviation MRO quality assurance and control platform for managing audits, findings, tasks, and work packages.
colors:
  signal-blue: "#2563eb"
  signal-blue-hover: "#1d4ed8"
  signal-blue-surface: "#eff6ff"
  amber-caution: "#d97706"
  amber-caution-surface: "#fffbeb"
  red-finding: "#dc2626"
  red-finding-surface: "#fef2f2"
  emerald-clear: "#059669"
  emerald-clear-surface: "#ecfdf5"
  ink-primary: "#1e293b"
  ink-secondary: "#475569"
  ink-muted: "#94a3b8"
  surface-base: "#f8fafc"
  surface-card: "#ffffff"
  border-default: "#e2e8f0"
  border-subtle: "#f1f5f9"
typography:
  display:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.04em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "{colors.signal-blue-hover}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  nav-item-default:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  nav-item-active:
    backgroundColor: "{colors.signal-blue-surface}"
    textColor: "{colors.signal-blue}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  input-default:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.md}"
    padding: "24px"
  badge-caution:
    backgroundColor: "{colors.amber-caution-surface}"
    textColor: "{colors.amber-caution}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  badge-finding:
    backgroundColor: "{colors.red-finding-surface}"
    textColor: "{colors.red-finding}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  badge-clear:
    backgroundColor: "{colors.emerald-clear-surface}"
    textColor: "{colors.emerald-clear}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
---

# Design System: SQD-APP

## 1. Overview

**Creative North Star: "The Technical Manual"**

SQD-APP is designed like a well-structured technical manual: every element earns its place through function, hierarchy is derived from information importance, and no decoration is applied without a structural reason. The system communicates authority through precision — tight typographic rhythm, a disciplined neutral palette, and a status-color vocabulary that fires only when something genuinely demands attention.

This is a tool used by maintenance technicians and quality officers under operational conditions. It must be readable at a glance, scannable under time pressure, and absolutely unambiguous about status. The interface does not attempt to charm or engage — it informs and enables. Restraint is the aesthetic: the absence of noise is itself the signal that the system is under control.

The palette is slate-forward with a single Signal Blue accent that marks interactive elements and active states. Status colours — amber for caution, red for findings and overdue, emerald for cleared/complete — appear only in badges and alert surfaces, never as decorative elements. A screen free of amber and red is a screen reporting a healthy system.

**Key Characteristics:**
- Dense-but-legible: tight rows, clear typographic hierarchy, breathing room earned through structure not padding
- Status-first: finding counts, overdue indicators, and escalation badges are impossible to miss
- Role-adaptive: the interface surfaces what each role needs — a staff member's view differs meaningfully from a director's
- Flat-by-default: depth is structural (card vs. page vs. sidebar) not decorative (gradients, glows)
- Monochromatic discipline: Signal Blue does exactly one job; status colours do theirs; the rest is slate

## 2. Colors: The Manual Palette

A slate-anchored neutral foundation with a single interactive blue and three functional status colours. Every colour is present because it carries information.

### Primary
- **Signal Blue** (`#2563eb`): The sole interactive accent. Used for primary buttons, active navigation states, focus rings, links, and form field focus borders. Its rarity on a neutral screen makes it unambiguous: Signal Blue means "act here."
- **Signal Blue Hover** (`#1d4ed8`): Deepened state for hover on Signal Blue elements. Never used as a standalone colour.
- **Signal Blue Surface** (`#eff6ff`): The tinted background behind active navigation items and selected states. Low saturation, high legibility.

### Secondary
- **Amber Caution** (`#d97706`): Overdue tasks, warnings, unresolved escalations, and badge counts on navigation items requiring attention. The colour of a caution placard — present only when warranted.
- **Amber Caution Surface** (`#fffbeb`): Background tint behind amber status badges and caution alerts.

### Tertiary
- **Red Finding** (`#dc2626`): Open findings, error states, and validation failures. The highest-urgency status colour. Never used decoratively — its presence always means something is wrong.
- **Red Finding Surface** (`#fef2f2`): Background tint for error alerts and finding status chips.
- **Emerald Clear** (`#059669`): Completed tasks, closed findings, and cleared work packages. Used sparingly; its presence signals resolution.
- **Emerald Clear Surface** (`#ecfdf5`): Background tint for cleared/complete status chips.

### Neutral
- **Ink Primary** (`#1e293b`, slate-800): Primary text — headings, table data, labels that carry decisions.
- **Ink Secondary** (`#475569`, slate-600): Supporting text, descriptions, inactive navigation labels.
- **Ink Muted** (`#94a3b8`, slate-400): Placeholders, disabled states, timestamp metadata.
- **Surface Base** (`#f8fafc`, slate-50): Page background. Barely-off-white — the absence of colour.
- **Surface Card** (`#ffffff`): Card and panel backgrounds. Provides 1-step tonal lift over the page.
- **Border Default** (`#e2e8f0`, slate-200): Card edges, table dividers, section boundaries.
- **Border Subtle** (`#f1f5f9`, slate-100): Internal row dividers, subtle separators within cards.

### Named Rules
**The One Signal Rule.** Signal Blue is the only colour used for interactive affordances. No secondary accent, no gradient treatment, no coloured icon fills on navigation. If the user needs to act on something, it is blue. If it is not blue, it is for reading — not for clicking.

**The Status Firewall Rule.** Amber, Red, and Emerald are status colours, not brand colours. They appear only on status chips, alert surfaces, badge counts, and system-reported conditions. They are prohibited on buttons, illustrations, decorative borders, or any element that does not carry live system status.

## 3. Typography

**Primary Font:** Geist Sans (with `system-ui, sans-serif` fallback)
**Mono Font:** Geist Mono (with `ui-monospace, monospace` fallback)

**Character:** A single geometric sans-serif family across all roles. No display serif, no expressive headline cut. The system communicates through hierarchy and weight, not through typographic personality. Geist's technical clarity reads as competence; its mono variant carries employee IDs, schema field names, and log entries without visual noise.

### Hierarchy
- **Display** (700 weight, 1.25rem / 20px, -0.02em tracking): Section headings on dashboard and detail pages. Appears once per view — page-level titles only.
- **Headline** (600 weight, 1.125rem / 18px, -0.01em tracking): Widget headings, card titles, modal headings.
- **Title** (600 weight, 0.9375rem / 15px, normal tracking): Table column headers, sidebar section labels, form group labels.
- **Body** (400 weight, 0.875rem / 14px, 1.6 line-height): All prose content, descriptions, activity feed text, task form fields. Max line length 72ch on content-heavy surfaces.
- **Label** (600 weight, 0.75rem / 12px, 0.04em tracking, uppercase): Status badge text, role chips, navigation item category dividers, metadata tags.
- **Mono** (400 weight, 0.8125rem / 13px): Employee IDs, task reference numbers, schema keys, log entries. Distinguishes system-generated identifiers from human-written content.

### Named Rules
**The Weight-Not-Size Rule.** Hierarchy is expressed through weight contrast before size contrast. A Title and a Body label are close in size but distinct in weight (600 vs 400). Reserve size increases for genuine level jumps — not to compensate for weak weight contrast.

**The Uppercase Ceiling Rule.** Uppercase with tracked letterspacing is limited to Labels (badges, metadata chips, nav dividers). It is prohibited on headings, body copy, buttons, or any element larger than 12px. More than one tracked-uppercase label per component is always wrong.

## 4. Elevation

SQD-APP is flat by structural layer. Depth is conveyed through surface colour (base vs. card vs. modal) and border separation, not shadow stacking. This matches the technical manual aesthetic: a printed document does not cast shadows.

Cards sit on the base surface with a `1px` border (`#e2e8f0`). Modals and popovers use a light `box-shadow` for structural separation from the page. No decorative drop shadows on cards at rest; no glows, no multi-layer shadows.

### Shadow Vocabulary
- **Card** (none at rest): Cards use border-only separation. No shadow unless hovered or in an interactive state.
- **Card Hover** (`0 4px 16px rgba(15, 23, 42, 0.08)`): Subtle lift on interactive cards. Not applied to data cards — only to clickable summary widgets.
- **Popover / Dropdown** (`0 8px 24px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.06)`): Menus and dropdowns that float above page content.
- **Modal** (`0 20px 48px rgba(15, 23, 42, 0.18)`): Dialog elevation. Appears with a backdrop overlay.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. A shadow that appears without a user action (hover, focus, modal open) is a decoration masquerading as structure — forbidden.

## 5. Components

### Buttons
Confident and direct. No icon-only decoration; label-first. No lowercase, no sentence case that reads casual.

- **Shape:** Gently curved (12px radius)
- **Primary:** Signal Blue background (`#2563eb`), white text, 12px × 20px padding, 600 weight, 0.875rem. Shadow: `0 2px 6px rgba(37, 99, 235, 0.25)` — the one place Signal Blue casts a light glow.
- **Hover:** Deepens to `#1d4ed8`, shadow slightly lifts: `0 4px 12px rgba(37, 99, 235, 0.30)`. Transition: `background 150ms ease-out, box-shadow 150ms ease-out`.
- **Disabled:** 60% opacity on the whole button. No separate disabled colour — the opacity signals unavailability without introducing a new token.
- **Ghost:** Transparent background, Ink Secondary text (`#475569`), border `1px solid #e2e8f0`. Hover: slate-50 background, Ink Primary text. Used for secondary actions alongside a primary.
- **Destructive:** Red Finding surface background with Red Finding text. Used only in destructive confirmation dialogs, never as a primary action trigger.

### Status Badges / Chips
The most critical component in the system. Read in under one second.

- **Shape:** Pill (9999px radius), 0.75rem uppercase Label typography, 2px × 10px padding
- **Caution (Overdue, Warning):** Amber Caution Surface bg, Amber Caution text
- **Finding (Open, Error):** Red Finding Surface bg, Red Finding text
- **Clear (Closed, Complete):** Emerald Clear Surface bg, Emerald Clear text
- **Neutral (Draft, Inactive):** Slate-100 bg (`#f1f5f9`), Ink Muted text (`#94a3b8`)
- **Active/In Progress:** Signal Blue Surface bg, Signal Blue text

**The One-Badge Rule.** No element carries more than one status badge. If two statuses apply (overdue AND has a finding), surface the higher-urgency one. The interface resolves conflicts; it does not pile them on the user.

### Cards / Containers
- **Corner Style:** Gently curved (12px radius for standard cards, 16px for top-level page panels)
- **Background:** Surface Card (`#ffffff`) on Surface Base (`#f8fafc`) page background
- **Shadow Strategy:** Border-only at rest (`1px solid #e2e8f0`). Card hover shadow only on interactive summary widgets.
- **Internal Padding:** 24px standard (`p-6`), 16px for compact data cards
- **Nesting:** Never. Nested cards are prohibited. Use section headers and internal dividers (`1px solid #f1f5f9`) for sub-grouping within a card.

### Inputs / Fields
- **Style:** White background, 1px slate-200 border, 12px radius, 12px × 16px padding
- **Focus:** 2px Signal Blue ring (`#2563eb`), border becomes transparent. Transition: `box-shadow 120ms ease-out`.
- **Placeholder:** Ink Muted (`#94a3b8`). Contrast verified at 4.5:1 against white.
- **Error:** Red Finding border (`#dc2626`), Red Finding Surface background, error message below in Red Finding text at Label size.
- **Disabled:** 60% opacity, cursor: not-allowed.

### Navigation (Sidebar)
- **Container:** 256px fixed width, white background, 1px right border (`#e2e8f0`)
- **Item default:** Transparent bg, Ink Secondary text (`#475569`), 5px icon, 12px radius, 10px × 12px padding
- **Item hover:** Slate-50 background (`#f8fafc`), Ink Primary text
- **Item active:** Signal Blue Surface background (`#eff6ff`), Signal Blue text (`#2563eb`), Signal Blue icon. Font weight 500.
- **Badge on nav item:** Amber Caution pill badge, right-aligned. Disappears when count reaches 0.
- **Typography:** Body weight (400) default, 500 active. No uppercase, no tracked spacing.

### Data Tables / Lists
- **Row height:** 48px standard, 40px compact
- **Row divider:** `1px solid #f1f5f9` (Border Subtle)
- **Hover row:** Slate-50 background
- **Header row:** Border Default below, Title typography (600 weight), Ink Secondary colour
- **Status column:** Always the rightmost or second-to-last column — fixed position so the eye knows where to look

### Header (Top Bar)
- **Style:** White background, 1px bottom border (`#e2e8f0`), 64px height
- **Content:** Page title (Headline weight) left-aligned, action buttons and user avatar right-aligned
- **Shadow:** None. Separation is via border, not elevation.

## 6. Do's and Don'ts

### Do:
- **Do** use Signal Blue exclusively for interactive affordances (buttons, links, active nav, focus rings). Its monopoly on interaction is what makes it trustworthy.
- **Do** use status colours (Amber, Red, Emerald) only on live system-reported conditions: badge counts, status chips, alert surfaces. Remove them the moment the condition clears.
- **Do** keep body text at Ink Primary (`#1e293b`) on Surface Card (`#ffffff`) — confirmed 4.5:1+ contrast. Never lighten body text to Ink Secondary or Ink Muted for "elegance."
- **Do** use Geist Mono for employee IDs, task reference numbers, schema field names, and any system-generated identifier. The visual distinction from prose is a legibility cue, not a stylistic choice.
- **Do** express hierarchy through font weight contrast before font size contrast. Title (600) and Body (400) at similar sizes is correct. Two sizes of 400-weight text is ambiguous.
- **Do** keep cards flat at rest. Border separation is structural; shadow at rest is decoration.
- **Do** verify every new status badge achieves 4.5:1 contrast between text and its surface background.
- **Do** use `text-wrap: balance` on page-level headings (Display, Headline) to prevent awkward single-word orphan lines.

### Don't:
- **Don't** use gradient text (`background-clip: text` with a gradient). Prohibited on all elements. The welcome banner's current gradient text on the user name is a known violation — fix before shipping.
- **Don't** make the interface look like a consumer SaaS product (Notion, Linear, Figma): no playful blob backgrounds, no pastel accent colours, no whitespace-as-personality, no rounded-2xl everywhere. This is not a productivity tool for knowledge workers.
- **Don't** tip into military-ops UI theatre: no dark-mode-by-default, no amber glows, no radar-screen aesthetics, no excessive dark surfaces. The "serious and bold" brand personality is expressed through typographic weight and structure — not through LARP-ing an ops room.
- **Don't** use `border-left` or `border-right` wider than 1px as a coloured stripe accent on cards, list items, or alerts. The error alert's current `border-l-4 border-red-500` is a known violation — replace with a full border or a tinted background surface.
- **Don't** apply hover shadows to non-interactive cards (data display, metric read-outs). Shadow lift is an interactive affordance. Applying it to read-only content implies clickability that isn't there.
- **Don't** use uppercase tracked letters above 12px or on more than one element per component. One uppercase label per widget is voice; uppercase everywhere is noise.
- **Don't** introduce a second accent colour without a specific, documented status role. "I wanted a bit of purple" is not a reason. The palette is closed.
- **Don't** nest cards. A card inside a card is always wrong. Use internal dividers (`1px solid #f1f5f9`) and section headings within a single card instead.
- **Don't** rely on colour alone to communicate status. Every status badge carries a text label alongside its colour. Colour reinforces — it does not replace — the label.
