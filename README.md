# Recountix

**Version:** Rc.0.05 – Production Candidate (Supabase Multi-Tenant)

Commercial receivables and recovery management for multiple businesses.  
Only Super Admin can onboard new businesses. No public registration.

## Features

- Professional multi-business UI
- Supabase system of record; encrypted offline backups use IndexedDB
- Super Admin: dashboard, company CRUD, activate/deactivate, subscriptions, renew
- Business Admin / User: customers, recovery, reports, settings (server-scoped by `shop_id`)
- Excel template / bulk import / export
- Outstanding auto-update on recovery
- Reports: filter, CSV export, print
- Remember me + Forgot password (admin-assisted reset)
- Modular JavaScript


## Future roadmap

- Customer self-view portal: customers can securely check their own bill amount, paid amount, pending amount, last payment and payment status without seeing any other customer's data.
- Multi-language UI: Gujarati, Hindi and English language support with a simple language switcher. Start with customer-facing screens first, then extend to admin dashboards and reports.

## Authentication

No default production credentials are published. Create a unique Super Admin credential during the
controlled deployment process, use a password manager, and rotate any earlier test credentials.

## Setup

1. Supabase → SQL Editor → run in order:
   - `database/supabase_schema.sql`
   - `database/super_admin_migration.sql`
2. Confirm tables: `shops`, `users`, `customers`, `recoveries`, `settings`, `subscriptions`, `audit_log`
3. Open `frontend/login.html` or deploy `frontend/` to GitHub Pages / any static host
4. Apply `database/security_foundation.sql` and follow `SECURITY_DEPLOYMENT.md`

## Supabase Config

`frontend/js/supabase.js`

- URL: `https://niroqvhpyrwulzwiyctl.supabase.co`
- Anon key: publishable key (already set)

## Structure

```
frontend/
  login.html, dashboard.html, customers.html, recovery.html,
  reports.html, settings.html, super-dashboard.html,
  companies.html, subscription.html
  css/style.css
  js/
    supabase.js   – client + session
    auth.js       – login / roles / logout
    utils.js      – formatters / helpers
    db.js         – all Supabase CRUD
    app.js        – customers, recovery, reports, settings UI
    company.js    – super-admin company & subscription UI
    excel-import.js
database/
  supabase_schema.sql
  super_admin_migration.sql
```

## Security notes

- Browser sessions are verified by server-side RPCs and expire automatically.
- Business tables use deny-by-default RLS; browser access is through scoped RPCs.
- Tenant identity and roles are derived server-side, never trusted from browser storage.
- Follow [SECURITY_DEPLOYMENT.md](SECURITY_DEPLOYMENT.md) before any production rollout.

## Rc.0.05 release status

- Functional smoke testing completed
- Mobile/responsive verification completed
- Network, invalid-session and error-path checks completed
- Security regression workflow and GitHub Pages deployment required to pass
- Per-business encrypted offline backup and restore verified

## Developed by

**BK Design Hub** · Recountix Commercial Edition
