# Recountix security deployment

Do not deploy the security frontend before the database migration succeeds.

## Required order

1. Back up the Supabase database.
2. Test on a separate Supabase project first.
3. Apply the existing schema/migrations in their documented order.
4. Apply `database/security_foundation.sql`.
5. Confirm the final status row is returned.
6. Deploy the `security/production-hardening` frontend to staging.
7. Test every role and workflow below.
8. Merge/deploy to production only after all tests pass.

## Mandatory tests

- Valid login works; five bad attempts trigger the temporary lock.
- Editing Local Storage role/shop/user values forces logout.
- Expired, revoked and deactivated-shop sessions cannot access pages.
- Super Admin can manage shops/subscriptions/maintenance/ads.
- Shop Admin sees only its own users, customers, recoveries, settings and reports.
- Normal User cannot manage users, delete protected records or open Super Admin pages.
- Customer create/edit/delete works without cross-shop access.
- Recovery save/delete updates outstanding exactly once.
- PTP, escalation, activity, field check-in, legal notice, payment link and receipt work.
- Field PIN is never returned to the browser and locks after repeated failures.
- Excel import accepts at most 500 rows and assigns the verified session shop.
- Direct REST reads/writes to every business table with the anon key are denied.
- Audit records are not directly editable or deletable.

## Rollback

Keep the current production deployment available. If staging verification fails, do not merge the frontend
and do not apply the lockdown to production. Database rollback must restore the pre-migration backup;
do not recreate the former public-all policies on a live database.

## Secrets

Never store payment-provider, WhatsApp or SMS secrets in browser-readable tables. Move real credentials
to Supabase Edge Function secrets or the deployment provider's encrypted environment variables.
Rotate any credential that may previously have been stored in `shops`.
