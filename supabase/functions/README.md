# Recountix Supabase Edge Functions

## payment-webhook

Receives payment gateway webhooks and marks matched payment links as paid.

Required secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RAZORPAY_WEBHOOK_SECRET`
- `PAYMENT_WEBHOOK_REQUIRE_SIGNATURE=true`

Deploy:

```bash
supabase functions deploy payment-webhook
supabase secrets set RAZORPAY_WEBHOOK_SECRET=...
```

## reminder-dispatcher

Processes pending rows from `reminder_queue`.

Required secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional secrets:

- `RECOUNTIX_CRON_SECRET`
- `REMINDER_PROVIDER_ENDPOINT`
- `REMINDER_PROVIDER_TOKEN`

Deploy:

```bash
supabase functions deploy reminder-dispatcher
```
