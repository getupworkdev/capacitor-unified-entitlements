-- One subscription entitlement across Stripe, App Store and Google Play.
-- Clients can read their own rows. Only the webhook functions (service role) write.

create table if not exists public.entitlements (
  user_id        uuid        not null references auth.users (id) on delete cascade,
  source         text        not null check (source in ('stripe', 'app_store', 'play_store', 'promotional')),
  product_id     text,
  status         text        not null check (status in ('active', 'expired', 'revoked')),
  period_type    text        not null check (period_type in ('trial', 'intro', 'normal', 'lifetime')),
  expires_at     timestamptz,            -- null = does not expire
  will_renew     boolean     not null default false,
  billing_issue  boolean     not null default false,
  last_event_at  timestamptz not null,   -- provider event time; older events never overwrite newer state
  updated_at     timestamptz not null default now(),
  primary key (user_id, source)
);

-- Every webhook delivery is recorded once. A second delivery of the same event id is a no-op.
create table if not exists public.webhook_events (
  provider     text        not null check (provider in ('stripe', 'revenuecat')),
  event_id     text        not null,
  event_type   text        not null,
  received_at  timestamptz not null default now(),
  outcome      text,
  primary key (provider, event_id)
);

alter table public.entitlements   enable row level security;
alter table public.webhook_events enable row level security;

drop policy if exists "read own entitlements" on public.entitlements;
create policy "read own entitlements" on public.entitlements
  for select to authenticated
  using (user_id = (select auth.uid()));
-- No insert/update/delete policies: clients cannot grant themselves premium.
-- webhook_events has no policies at all: service role only.

-- The single question the app asks: is this user premium right now?
create or replace view public.my_access
with (security_invoker = true) as
select
  coalesce(bool_or(status = 'active' and (expires_at is null or expires_at > now())), false) as premium,
  max(expires_at) filter (where status = 'active')                                         as expires_at,
  bool_or(billing_issue) filter (where status = 'active')                                  as billing_issue,
  array_agg(source order by expires_at desc nulls first)
    filter (where status = 'active' and (expires_at is null or expires_at > now()))        as active_sources
from public.entitlements
where user_id = (select auth.uid());

-- Upsert that refuses out-of-order events. Returns 'applied' or 'stale'.
create or replace function public.apply_entitlement(
  p_user_id uuid, p_source text, p_product_id text, p_status text, p_period_type text,
  p_expires_at timestamptz, p_will_renew boolean, p_billing_issue boolean, p_last_event_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  insert into public.entitlements as e
    (user_id, source, product_id, status, period_type, expires_at, will_renew, billing_issue, last_event_at, updated_at)
  values
    (p_user_id, p_source, p_product_id, p_status, p_period_type, p_expires_at, p_will_renew, p_billing_issue, p_last_event_at, now())
  on conflict (user_id, source) do update set
    product_id    = excluded.product_id,
    status        = excluded.status,
    period_type   = excluded.period_type,
    expires_at    = excluded.expires_at,
    will_renew    = excluded.will_renew,
    billing_issue = excluded.billing_issue,
    last_event_at = excluded.last_event_at,
    updated_at    = now()
  where e.last_event_at <= excluded.last_event_at;

  get diagnostics v_rows = row_count;
  return case when v_rows = 1 then 'applied' else 'stale' end;
end;
$$;

revoke all on function public.apply_entitlement from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.apply_entitlement to service_role;
  end if;
end $$;
