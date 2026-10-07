-- Recountix performance hardening
-- Adds covering indexes for all foreign keys reported by the Supabase advisor.
create index if not exists idx_ads_target_shop_id_fk on public.ads (target_shop_id);
create index if not exists idx_agent_activity_log_shop_id_fk on public.agent_activity_log (shop_id);
create index if not exists idx_agent_activity_log_task_id_fk on public.agent_activity_log (task_id);
create index if not exists idx_agent_tasks_assigned_by_fk on public.agent_tasks (assigned_by);
create index if not exists idx_agent_tasks_customer_id_fk on public.agent_tasks (customer_id);
create index if not exists idx_audit_log_user_id_fk on public.audit_log (user_id);
create index if not exists idx_customer_invoices_shop_id_fk on public.customer_invoices (shop_id);
create index if not exists idx_customers_assigned_agent_id_fk on public.customers (assigned_agent_id);
create index if not exists idx_escalations_assigned_to_fk on public.escalations (assigned_to);
create index if not exists idx_escalations_customer_id_fk on public.escalations (customer_id);
create index if not exists idx_escalations_resolved_by_fk on public.escalations (resolved_by);
create index if not exists idx_field_sessions_agent_id_fk on public.field_sessions (agent_id);
create index if not exists idx_legal_notices_created_by_fk on public.legal_notices (created_by);
create index if not exists idx_legal_notices_shop_id_fk on public.legal_notices (shop_id);
create index if not exists idx_payment_links_created_by_fk on public.payment_links (created_by);
create index if not exists idx_payment_links_recovery_id_fk on public.payment_links (recovery_id);
create index if not exists idx_promises_to_pay_kept_recovery_id_fk on public.promises_to_pay (kept_recovery_id);
create index if not exists idx_promises_to_pay_agent_id_fk on public.promises_to_pay (agent_id);
create index if not exists idx_promises_to_pay_created_by_fk on public.promises_to_pay (created_by);
create index if not exists idx_receipts_customer_id_fk on public.receipts (customer_id);
create index if not exists idx_recoveries_ptp_id_fk on public.recoveries (ptp_id);
create index if not exists idx_reminder_queue_customer_id_fk on public.reminder_queue (customer_id);
create index if not exists idx_users_manager_id_fk on public.users (manager_id);
create index if not exists idx_users_shop_id_fk on public.users (shop_id);
