# User rights and control

Business Admins open **Settings → User Management → Modify / Rights** to update
staff usernames, display names, active status and individual rights. Changes are
saved together. Admins can manage only their own business's ordinary User accounts.
Super Admin can manage ordinary User accounts across businesses. Neither can edit
their own rights here; administrator roles and platform controls are not delegated.
The existing Delete action remains available to authorized administrators.

| Right | Controls |
| --- | --- |
| View | Business records, dashboard, reports, activity and field customer lists |
| Add | Customers, recoveries, Excel imports, promises, activities, receipts and payment requests |
| Modify | Customer edits, recovery corrections, promise/escalation status, assignments and reminder scheduling |
| Delete | Existing customer, recovery and promise deletion endpoints |
| Business settings | Company details and the executive list |
| Backup | Create/export business backups and access device backup UI |
| Restore | Restore missing business records through the existing validated restore service |

All rights require View. **Allow all business rights**, **View only**, and
**Remove all rights** are shortcuts; each checkbox is editable individually.
New staff start with View only. Existing staff retain their previous View/Add/Modify
and Backup access until an administrator changes it. Existing admins keep full access.

Revocation takes effect on the next server request, including existing sessions.
Open pages refresh their permission state every 15 seconds and when returning to the
page. Deactivating a user also revokes app and field sessions. Already downloaded
files or data previously displayed cannot be recalled by permission changes.

Recovery corrections preserve the transaction ID and adjust the customer's outstanding
balance and stored receipt amounts atomically. Stale amount edits are rejected. An
already printed receipt cannot be updated; issue a corrected copy as needed.

## Database deployment

Apply `supabase/migrations/20260926155346_user_permissions.sql` **after** the existing
security foundation and backup migrations, before publishing the new frontend. Do not
replay older SQL files over this migration. This migration adds a private-to-API rights
table and scoped RPCs, then adds permission checks to the current RPC definitions.
It does not change existing customer or recovery data.

The application uses its existing opaque `app_sessions` tokens. Authorization derives
the actor and business from a validated server session, checks active business and
license state, and reads current permissions from the database. Browser role/permission
state controls presentation only. Permission changes and recovery corrections are audited.

## Verification

- Run `tests/user-permissions.sql` in a transaction after the migration, followed by
  `ROLLBACK`. It creates synthetic fixtures and tests grant/revoke, tenant boundaries,
  malformed permissions, suspended users/businesses, expiry, backups, field access,
  customer/recovery operations and financial reconciliation.
- Run `node scripts/security-check.mjs` and `node scripts/release-check.mjs`.
- Serve `frontend/` locally and run `node tests/user-permissions-ui.cjs` with Playwright
  1.62.1 and Chromium installed. `RECOUNTIX_TEST_URL` defaults to
  `http://127.0.0.1:8765`; optional `RECOUNTIX_SCREENSHOTS` is an output directory.
  These UI tests mock API responses; they complement the database tests.
