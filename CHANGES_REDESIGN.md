# Recountix — Visual Redesign Change Log

## What changed
A single new stylesheet, `frontend/css/recountix-2027.css`, replaces the old
stacked cascade of eight conflicting CSS files that had accumulated over
time (a leftover gold/jewellery ERP theme, a generic indigo SaaS theme,
and several partial patch layers all fighting each other with `!important`).
The new stylesheet is built entirely around the actual Recountix brand —
the deep teal → emerald gradient from the logo — with Inter (body) and
Outfit (headings) for type, consistent spacing/radius/shadow tokens, and a
mobile-first responsive sidebar drawer.

No element IDs, form field names, script imports, onclick handlers, or
navigation targets were changed anywhere. No backend/SQL/RPC/auth logic was
touched. `checkin.html` and `field-tracking.html` were left untouched, as
instructed.

## Files changed
- **Added:** `frontend/css/recountix-2027.css` — the new unified design system.
- **Edited (stylesheet links swapped, no markup logic changed):**
  index.html, login.html, dashboard.html, customers.html, recovery.html,
  ptp.html, escalations.html, activity.html, reports.html, settings.html,
  companies.html, subscription.html, super-dashboard.html, ad-manager.html,
  backup.html, maintenance.html
  — each had its 4–7 old `<link>` stylesheet tags replaced with one link to
  `recountix-2027.css`, plus Google Fonts (Inter/Outfit) added where missing.
- **Edited (one class added for CSS scoping only):** `maintenance.html`
  — added `class="maintenance-screen"` to `<body>` so its standalone
  dark/gold "under maintenance" screen keeps its own look instead of
  inheriting the app-shell card style. No IDs/handlers touched.
- **Edited (one line, offline cache list):** `sw.js` — added the new
  stylesheet to the offline-backup precache list so Offline Backup still
  looks right without a network connection.
- **Untouched:** all other JS, all HTML structure/content/IDs/handlers, all
  SQL/database files, all config, `checkin.html`, `field-tracking.html`.
- **Not deleted:** the old CSS files (`style.css`, `saas-2026.css`,
  `dashboard-part1.css`, `redesign-2026.css`, `final-suite.css`,
  `business-pro.css`, `design-v2.css`, `vo-customers-v1.css`,
  `vo-v2-redesign.css`) are still in `frontend/css/` but no longer linked
  from any page — safe to delete once you've confirmed everything looks
  right, or keep them for reference.

## Design system summary
- **Palette:** deep teal `#0A332C` → emerald `#12A77A` (sidebar, buttons,
  active states, focus rings), warm neutral background `#F3F7F5`, white
  cards, restrained status colors for success/warning/danger/info.
- **Type:** Outfit for headings, Inter for body/UI — matches what
  `login.html` already used, now applied everywhere.
- **Sidebar:** fixed dark teal gradient, becomes an off-canvas drawer under
  880px (uses the existing `#menuToggle` / `#sidebarOverlay` / `.open` /
  `.sidebar-open` hooks already in your JS — nothing new to wire up).
- **Components restyled consistently:** KPI cards, dashboard analytics
  panels, quick-action strips, record-navigation cards, tables, forms,
  modals, badges, buttons, toasts, the offline-backup panels, and the
  printable customer-statement report (`#cleanPrintReport`) — colors
  rebranded to teal, same print mechanism.
- **Responsive:** down to small phones; keyboard focus rings preserved;
  respects `prefers-reduced-motion`.

## Suggested next step
Open `dashboard.html`, `customers.html`, and `login.html` in a browser to
confirm the look before deleting the old CSS files.
