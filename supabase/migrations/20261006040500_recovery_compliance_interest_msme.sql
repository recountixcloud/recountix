-- Recountix recovery compliance foundation
-- Interest calculation, MSME 45-day statutory tracking, and demand notice telemetry.

alter table if exists public.shops
  add column if not exists default_interest_rate_pa numeric(6,2) not null default 18.00;

alter table if exists public.customers
  add column if not exists interest_rate_pa numeric(6,2),
  add column if not exists msme_45_day_start date,
  add column if not exists msme_45_day_due date,
  add column if not exists demand_notice_count integer not null default 0,
  add column if not exists last_demand_notice_at timestamptz;

create or replace function public.app_calculate_delayed_interest(
  p_principal numeric,
  p_due_date date,
  p_as_of date default current_date,
  p_rate_pa numeric default 18.00
)
returns numeric
language sql
stable
as $$
  select round(
    greatest(coalesce(p_principal, 0), 0)
    * greatest(coalesce(p_rate_pa, 0), 0) / 100
    * greatest(coalesce(p_as_of, current_date) - coalesce(p_due_date, p_as_of), 0)
    / 365,
    2
  );
$$;

create or replace function public.app_msme_45_day_status(
  p_start_date date,
  p_as_of date default current_date
)
returns table (
  days_elapsed integer,
  days_left integer,
  status text
)
language sql
stable
as $$
  select
    greatest(coalesce(p_as_of, current_date) - coalesce(p_start_date, p_as_of), 0)::integer as days_elapsed,
    greatest(45 - greatest(coalesce(p_as_of, current_date) - coalesce(p_start_date, p_as_of), 0), 0)::integer as days_left,
    case
      when p_start_date is null then 'not_started'
      when greatest(coalesce(p_as_of, current_date) - p_start_date, 0) >= 45 then 'statutory_overdue'
      when greatest(coalesce(p_as_of, current_date) - p_start_date, 0) >= 35 then 'urgent'
      else 'within_window'
    end as status;
$$;

create or replace function public.app_customer_recovery_compliance(
  p_customer_id uuid,
  p_as_of date default current_date
)
returns table (
  customer_id uuid,
  outstanding numeric,
  days_overdue integer,
  interest_rate_pa numeric,
  interest_amount numeric,
  msme_days_elapsed integer,
  msme_days_left integer,
  msme_status text,
  demand_notice_count integer,
  last_demand_notice_at timestamptz
)
language sql
stable
as $$
  with customer_base as (
    select
      c.id,
      coalesce(c.balance, c.outstanding, 0)::numeric as outstanding_amount,
      coalesce(c.due_date, c.created_at::date) as due_on,
      coalesce(c.interest_rate_pa, s.default_interest_rate_pa, 18.00) as rate_pa,
      coalesce(c.msme_45_day_start, c.created_at::date) as msme_start_on,
      c.demand_notice_count,
      c.last_demand_notice_at
    from public.customers c
    left join public.shops s on s.id = c.shop_id
    where c.id = p_customer_id
  )
  select
    cb.id,
    cb.outstanding_amount,
    greatest(coalesce(p_as_of, current_date) - coalesce(cb.due_on, p_as_of), 0)::integer,
    cb.rate_pa,
    public.app_calculate_delayed_interest(cb.outstanding_amount, cb.due_on, p_as_of, cb.rate_pa),
    msme.days_elapsed,
    msme.days_left,
    msme.status,
    cb.demand_notice_count,
    cb.last_demand_notice_at
  from customer_base cb
  cross join lateral public.app_msme_45_day_status(cb.msme_start_on, p_as_of) msme;
$$;

create or replace function public.app_mark_demand_notice_sent(
  p_customer_id uuid,
  p_notice_time timestamptz default now()
)
returns void
language plpgsql
as $$
begin
  update public.customers
  set
    demand_notice_count = coalesce(demand_notice_count, 0) + 1,
    last_demand_notice_at = coalesce(p_notice_time, now())
  where id = p_customer_id;
end;
$$;

comment on function public.app_calculate_delayed_interest(numeric, date, date, numeric)
  is 'Simple pro-rata delayed payment interest calculator for recovery workflows.';

comment on function public.app_msme_45_day_status(date, date)
  is 'Returns MSME 45-day elapsed/remaining days and urgency status.';

comment on function public.app_customer_recovery_compliance(uuid, date)
  is 'Customer-level recovery compliance rollup used by dashboard and demand-letter workflows.';

create or replace function public.app_projected_ptp_inflows(
  p_shop_id uuid,
  p_as_of date default current_date
)
returns table (
  window_days integer,
  promised_amount numeric
)
language sql
stable
as $$
  with windows(window_days) as (
    values (7), (15), (30)
  )
  select
    w.window_days,
    coalesce(sum(p.promised_amount), 0)::numeric(14,2) as promised_amount
  from windows w
  left join public.promises_to_pay p
    on p.shop_id = p_shop_id
   and p.status = 'open'
   and p.promised_date >= coalesce(p_as_of, current_date)
   and p.promised_date < coalesce(p_as_of, current_date) + w.window_days
  group by w.window_days
  order by w.window_days;
$$;

create or replace function public.app_recovery_exec_metrics(
  p_shop_id uuid,
  p_as_of date default current_date
)
returns table (
  total_outstanding numeric,
  recovered_this_month numeric,
  dso_approx numeric,
  ptp_next_7 numeric,
  ptp_next_15 numeric,
  ptp_next_30 numeric
)
language sql
stable
as $$
  with base as (
    select
      coalesce(sum(coalesce(c.balance, c.outstanding, 0)), 0)::numeric(14,2) as outstanding_amount
    from public.customers c
    where c.shop_id = p_shop_id
      and coalesce(c.status, 'Active') not in ('Closed', 'Deleted')
  ),
  recovered as (
    select
      coalesce(sum(r.amount), 0)::numeric(14,2) as month_amount,
      greatest(extract(day from coalesce(p_as_of, current_date))::numeric, 1) as elapsed_days
    from public.recoveries r
    where r.shop_id = p_shop_id
      and r.recovery_date >= date_trunc('month', coalesce(p_as_of, current_date))::date
      and r.recovery_date <= coalesce(p_as_of, current_date)
  ),
  ptp as (
    select
      coalesce(max(promised_amount) filter (where window_days = 7), 0)::numeric(14,2) as next_7,
      coalesce(max(promised_amount) filter (where window_days = 15), 0)::numeric(14,2) as next_15,
      coalesce(max(promised_amount) filter (where window_days = 30), 0)::numeric(14,2) as next_30
    from public.app_projected_ptp_inflows(p_shop_id, p_as_of)
  )
  select
    base.outstanding_amount,
    recovered.month_amount,
    case
      when recovered.month_amount <= 0 then null
      else round(base.outstanding_amount / nullif(recovered.month_amount / recovered.elapsed_days, 0), 1)
    end as dso_approx,
    ptp.next_7,
    ptp.next_15,
    ptp.next_30
  from base, recovered, ptp;
$$;

comment on function public.app_projected_ptp_inflows(uuid, date)
  is 'Projected cash inflow windows from active Promise-to-Pay commitments.';

comment on function public.app_recovery_exec_metrics(uuid, date)
  is 'Executive recovery dashboard metrics: outstanding, month recovery, approximate DSO, and PTP inflows.';
