# Handoff: meridio — Remote dev job board for LATAM

## Overview
A job board for Latin American developers looking for remote work. It works on mobile and desktop, has light and dark mode, and an ES / PT / EN language switch. Three views:
1. **Jobs** — search plus filters, with the job list
2. **Job detail** — full posting with an external Apply link
3. **Saved** — bookmarked jobs, stored on the device

Main UX goals: as few clicks as possible to reach the external application link, filters that are easy to see, and nothing confusing. Accounts are **optional** — saving works anonymously (localStorage); alerts only ask for an email.

## About the design files
The files in this bundle are **design references built in HTML**. They are prototypes showing the intended look and behavior, not production code to copy. Recreate them in the target codebase's existing stack, using its patterns and libraries. If there is no codebase yet (the linked repo `mhelenacipriano/meridio` was empty), pick a suitable framework — e.g. Next.js + React + TypeScript, with CSS variables or Tailwind for the tokens below.

Each `.dc.html` file opens directly in a browser (it needs `support.js` next to it). The markup sits inside `<x-dc>`. All behavior, copy (the translation tables) and sample data are in the `class Component` script at the bottom of each file — read it as the spec for state and logic.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii, states and copy are final. Recreate the UI pixel-accurately.

- **`Job Board v2.dc.html` — PRIMARY.** Soft and friendly style: DM Sans, rounded corners, light shadows, cobalt accent. Build this one.
- `Job Board.dc.html` — an alternative direction (Modernist: Archivo, 0 radius, strong 2px rules). Same structure and behavior. For reference only.

---

## Layout and responsive behavior
- **Breakpoint: 860px.** Below it is the mobile layout; at 860px and above is desktop.
- The app fills the viewport (`height: 100vh`, flex column). Header and filter toolbar don't shrink; the main area is `flex:1; min-height:0`, and each pane scrolls on its own.

### Desktop (≥ 860px)
```
┌ Header: logo · tagline ··········· [Jobs][Saved n]  [ES|PT|EN] [☾] ┐
├ Toolbar: [🔍 search ············] [Eligible from ▾] [Posted ▾] [🔔 Get alerts] │
│          ROLE (chips…)   SENIORITY (chips…)                  Clear all │
├──────────────────────────┬──────────────────────────────────────────┤
│ List pane                │ Detail pane (surface bg, max content 780) │
│ grid col minmax(340,440) │ grid col minmax(0,1fr)                    │
└──────────────────────────┴──────────────────────────────────────────┘
```
- Main area: `grid-template-columns: minmax(340px,440px) minmax(0,1fr)`.
- The first job in the current list is selected automatically. ↑ / ↓ keys move the selection (ignored while an input, select or textarea has focus, or a dialog is open).
- The toolbar is hidden in the Saved view.
- **Collapsible detail panel:**
  - Hide it with the X button (36×36, sticky at the top right of the detail pane) or with `Esc`.
  - A "Hide details / Show details" pill in the list header toggles it (panel-right icon, 32px tall, radius 999).
  - While hidden, the list spans the full width and cards reflow into `repeat(auto-fill,minmax(360px,1fr))` with a 10px gap.
  - Clicking any card reopens the panel on that job.
  - The open/closed preference is saved in localStorage (`meridio.panel`).

### Mobile (< 860px)
- The header keeps only the logo, language switch and theme toggle.
- **List screen:** a sticky row with search (44px tall, 16px font so iOS doesn't zoom) and a **Filters** button. The button shows the active count ("Filters · 3") and fills with the accent when the count is > 0. It opens a **bottom sheet**.
- **Bottom tab bar** (56px tall): Jobs / Saved, with a count badge. Hidden on the detail screen.
- **Detail screen:** full screen. Sticky top bar with "← Back"; sticky bottom bar with a 48×48 save icon button and an accent Apply button that fills the remaining width.
- Every hit target is ≥ 44px.

---

## Screens and components (v2 values)

### Header
- Background `--color-surface`, 1px bottom border `--color-divider`. Padding 12px 20px (mobile 10px 16px). Flex, gap 16.
- Logo: 22×22 accent square, radius 7, then "meridio" (20px / 700 / letter-spacing −0.02em), then the tagline on desktop only (13px, `--muted`, single line with ellipsis).
- Nav tabs (desktop): pill buttons, padding 8px 14px, radius 999, 14px. Active tab: background `color-mix(accent 12%, transparent)`, text `--accent-ink`, weight 700. Inactive: weight 400, hover background `--hover`. Saved count badge: 11px/600, padding 1px 6px, accent background, white text, radius 999. `aria-current="page"` on the active tab.
- Language segmented control: 1px divider border, radius 10, padding 2, gap 2. Each button: 12px/600, padding 6px 9px, min-height 30, radius 8. Active: background `color-mix(accent 14%)`, text `--accent-ink`. Uses `aria-pressed`.
- Theme toggle: 36×36, 1px divider border, radius 10. Shows a moon icon in light mode and a sun icon in dark mode. The aria-label is the action ("Switch to dark mode").

### Filter toolbar (desktop)
- Surface background, 1px bottom border, padding 16px 20px, two rows with gap 14.
- Row 1 (flex-wrap, gap 12, align end):
  - Search input (flex 1 1 300px): height 40, padding-left 36 for a 16px search icon at left 12, background `--field`, 1px divider border, radius 10, 14px. Focus border: accent.
  - "Eligible from" select (min-width 190) and "Posted" select (min-width 150). Each has a 12px `--muted` label above, height 40, radius 10.
  - "Get alerts" secondary button: height 40, bell icon, 14px/700, 1px divider border, radius 10, hover `--hover`.
- Row 2: chip groups labelled ROLE and SENIORITY (11px, uppercase, letter-spacing .08em, `--muted`).
  - Chips: padding 6px 12px, 13px, radius 999, 1px divider border, surface background.
  - Selected chip: accent background, white text, accent border, `aria-pressed="true"`. Multi-select.
  - "Clear all" text button sits at the right (margin-left:auto) and only shows when a filter is active. 13px/700, `--accent-ink`, underlined.

### Job list
- List header: padding 18px 24px 12px. H2 shows the count ("12 remote jobs", 15px/700); on the right, "Newest first" (12px, muted). In the Saved view: "Saved jobs (n)" · "On this device".
- **Job card** (`<article>`, the whole card is clickable): margin 0 12px 10px, padding 18px (mobile 16, compact 12px 20px), radius 14, surface background, `--shadow-card`. Hover: `--shadow-hover` and translateY(−1px), transition .15s. Selected: background `--sel`, 1px border `color-mix(accent 45%)`, title in `--accent-ink`.
  - Company logo: 40×40, radius 12, background `color-mix(accent 12%, surface)`, initials 13px/700 in `--accent-ink`. Real company logos should replace these.
  - Title: a real `<button>` for keyboard access, 16px/700, line-height 1.25. Below it: "Company · Eligibility · Contract" (13px, muted).
  - Bookmark icon button at top right: 36×36, radius 10. Filled accent when saved. `aria-pressed`, and the aria-label switches between "Save job" and "Remove from saved".
  - Tags row (gap 6): seniority pill (11px/600, accent 10% tint, `--accent-ink`, radius 999, padding 2px 8px), then up to 3 stack pills (2 in compact mode; background `--chip`).
  - Footer row (12px): a "NEW" badge if posted < 24h (10px/700 uppercase, accent background, white, radius 999), then relative time (muted), then salary (600) if listed. At the far right, the **quick Apply link** (13px/700, `--accent-ink`, external-link icon, radius 8, hover accent 10% tint). It opens the job URL in a new tab (`target="_blank" rel="noopener noreferrer"`) and calls `stopPropagation` so it doesn't select the card.
- **Empty states:**
  - No results: "No jobs match these filters" + hint + primary "Clear all".
  - Saved empty: "No saved jobs yet" + "Tap the bookmark…" + "Browse jobs".
- Desktop footer tip: "Tip: use ↑ ↓ to move through jobs." (12px, muted).

### Job detail
- Pane background `--color-surface`. Content padding 28px 36px 40px (mobile 20px 16px 28px), max-width 780, vertical gap 24.
- Head: 52×52 logo (radius 14, 17px initials), company (15px/600) and relative posted time (13px muted). Then H1 title: 34px (mobile 26px), weight 700, line-height 1.1, letter-spacing −0.02em.
- Actions row (desktop only; mobile uses the sticky bottom bar):
  - **Primary Apply link**: "Apply on {domain}" with an external icon, padding 12px 16px, min-width 220, accent background, white 15px/700, radius 12, shadow `0 4px 14px color-mix(accent 30%)`, hover accent-600. The label is flush left with the icon at the right.
  - Save / Saved secondary button with a bookmark icon.
  - Copy-link icon button (46×46). Shows a toast "Link copied".
  - Helper text "Opens in a new tab" (12px muted).
- Key facts box (`<dl>`): background `--color-bg`, radius 14, padding 4px 20px, grid `repeat(auto-fit,minmax(150px,1fr))`. Four cells: Seniority, Contract, Eligible from, Salary ("Not listed" when missing). Each label is 11px uppercase muted; each value 15px/600.
- Sections, each with an 18px/700 heading: "About the role" (15px paragraph, line-height 1.6), "What you'll need" (bulleted list), "Stack" (13px pills).
- Footnote above a 1px top border: "This posting is in English, as published by the company." Job content stays in its original language; only the interface is translated.

### Mobile filter sheet
- Backdrop `rgba(0,0,0,.5)`; clicking it closes the sheet. Sheet: max-height 88%, radius 20px 20px 0 0, `role="dialog" aria-modal`.
- Header: "Filters" plus a 44×44 close button.
- Body: Role chips, Seniority chips (44px tall), Eligible from select, Posted select (48px tall, 16px font), and a "Get alerts for this search" link.
- Footer: "Clear all" (secondary) and "Show {n} jobs" (primary, fills remaining width, live count). Filters apply immediately; the sheet just reflects them.

### Alert dialog
- Centered, max-width 440, padding 24, radius 18, `--shadow-lg`, backdrop at 50%.
- Title: "Get new jobs by email". Body: "We'll email you when new jobs match your current filters. No account or password needed."
- A summary line of the current filters (e.g. "Frontend · Senior · México · "react""), or "All remote jobs" if none.
- Email input (44px). "Create alert" stays disabled (opacity .45) until the email matches `^\S+@\S+\.\S+$`.
- Success state: "Alert created. Check your inbox to confirm your email." with a "Done" button. **Backend needed:** create the alert and send a double opt-in email.

### Toast
- Positioned bottom-left (bottom 20 on desktop; above the tab bar or sticky bar on mobile). Text-colored background, inverted text, 14px/600, radius 12. Auto-hides after 1.8s. Messages: "Saved", "Removed from saved", "Link copied". Use `role="status"`.

---

## Filtering logic
- **Search:** case-insensitive substring match on title + company + stack.
- **Role:** multi-select; a job matches if its role is in the selection (empty selection = all). Roles: Frontend, Backend, Full-stack, Mobile, DevOps / SRE, Data, QA.
- **Seniority:** multi-select. Junior · Mid-level · Senior · Lead / Staff. Localized names — ES: Junior · Semi Senior · Senior · Lead / Staff; PT: Júnior · Pleno · Sênior · Lead / Staff.
- **Eligible from (country):** "Anywhere in LATAM" (all), or one of Argentina, Brasil, Chile, Colombia, Costa Rica, México, Perú, Uruguay. A job matches if its eligibility includes "LATAM" (open to the whole region) or the selected country.
- **Posted:** Any time / Last 24 hours / Last 7 days / Last 30 days.
- Sort: newest first.
- On desktop, if the selected job drops out of the results, select the first result.
- Recommended: mirror the filters into the URL query string so searches can be shared.

## State
```
lang: 'es'|'pt'|'en'      // persisted (localStorage meridio.lang); first visit uses navigator.language
theme: 'light'|'dark'     // persisted (meridio.theme); first visit uses prefers-color-scheme
view: 'jobs'|'saved'
q, roles[], sens[], country ('all'|code), posted ('any'|'d1'|'d7'|'d30')
selectedId, detailOpen (mobile only)
saved: number[]           // persisted (meridio.saved); sync to the account if the user later adds an email
sheetOpen, alertOpen, alertSent, email, toast
```
- Set `data-theme` and `lang` on `<html>`.
- Relative time: under 1h "Just now" / "Ahora" / "Agora"; under 24h "3 h ago" / "hace 3 h" / "há 3 h"; otherwise days.

**Job data model** (from the prototype):
```
{ id, title, company, logo, role, seniority, eligibility: ['LATAM'] | ['BR','MX',…],
  postedAt, salary: string|null (USD / month), contract: 'contractor'|'fulltime',
  stack: string[], url (external application link), about, requirements: string[] }
```
- Contract labels — EN: Contractor / Full-time; ES: Contractor / Tiempo completo; PT: PJ / Contractor / Tempo integral.
- All interface strings for the three languages are in `static T` in the file's script. Copy them as-is into your i18n files.

## Design tokens (v2)
| Token | Light | Dark |
|---|---|---|
| `--color-bg` | #f5f6fa | #111319 |
| `--color-surface` | #ffffff | #1a1d25 |
| `--color-text` | #1b1f2a | #e8eaf0 |
| `--color-divider` | text @ 11% | text @ 12% |
| `--muted` | text @ 62% | text @ 62% |
| `--hover` | text @ 5% | text @ 5% |
| `--chip` | text @ 6% | text @ 6% |
| `--field` | = bg | = bg |
| `--sel` | accent 6% over surface | accent 14% over surface |
| `--accent-ink` (small accent text) | accent-700 | accent-400 |
| `--on-accent` | #ffffff | #ffffff |

**Accent** (cobalt, default): 500 `#2f5bea` · 400 `#7f9bff` · 600 `#2448c9` (hover) · 700 `#1a3699`.
Alternative accents the user can preview in Tweaks:
- green `#0f8a5f / #4fc493 / #0b7550 / #075c3e`
- violet `#6b4ce6 / #a48cff / #5838c9 / #432a9c`
- teal `#0e7c86 / #4fc0c8 / #0b6970 / #08535a`

**Shadows**
- Light:
  - card `0 1px 2px rgba(20,30,60,.05), 0 4px 14px rgba(20,30,60,.05)`
  - hover `0 2px 4px rgba(20,30,60,.06), 0 10px 24px rgba(20,30,60,.09)`
  - md `0 4px 14px rgba(20,30,60,.12)`
  - lg `0 20px 48px rgba(20,30,60,.2)`
- Dark: same steps, each with a 1px `rgba(255,255,255,.04–.08)` ring plus a black ambient shadow (see the file).

**Radius:** 7 (logo mark) · 8 (small buttons, links) · 10 (buttons, inputs) · 12–14 (cards, logos, Apply button) · 18 (dialog) · 20 (sheet top) · 999 (chips, tags, tabs, badges).

**Type:** DM Sans (Google Fonts, weights 400 / 500 / 700). Base 15px / 1.5.
- Scale: 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 26, 34.
- Headings use weight 700.
- Uppercase labels: 11px with letter-spacing .08em.

**Spacing:** a 4px base — 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 36, 40.

**Focus:** `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }`. Never show the browser's default ring.

## Assets
- **Icons:** Lucide (https://lucide.dev) — search, bookmark, external-link, sun, moon, x, sliders-horizontal, arrow-left, bell, copy. Use the `lucide-react` package; stroke width 2.
- **Company logos:** the prototype uses initials as placeholders. Use real logos from the job data, and fall back to initials.
- No photography.

## Accessibility checklist
- `aria-pressed` on chips, language buttons and bookmark buttons; `aria-current` on tabs and the selected card.
- Dialogs and the sheet use `role="dialog" aria-modal`. **TODO in production:** trap focus, close on Esc, and return focus when closed.
- External links say where they go ("Apply on {domain}") and open in a new tab with `rel="noopener noreferrer"`.
- Text contrast meets 4.5:1. Small accent-colored text uses `--accent-ink`.

## Screenshots
`screenshots/` holds reference captures of v2:
- **Desktop:** jobs (light), filters active, details hidden, saved, alert dialog, dark, dark in Spanish
- **Mobile:** list, filter sheet, detail, detail in dark

## Files
- `Job Board v2.dc.html` — primary design (soft and friendly)
- `Job Board.dc.html` — alternative design (Modernist); needs `styles.css`
- `styles.css` — Modernist tokens, used only by the alternative
- `support.js` — runtime that lets the `.dc.html` prototypes open in a browser
