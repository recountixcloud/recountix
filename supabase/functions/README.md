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

## reminder-queue

Creates due reminder jobs inside Supabase `reminder_queue`. This function does not send customer data to WhatsApp/email providers. External sending should be added only after the exact provider endpoint and data-sharing approval are confirmed.

Required secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional secret:

- `RECOUNTIX_CRON_SECRET`

Deploy:

```bash
supabase functions deploy reminder-queue
```
