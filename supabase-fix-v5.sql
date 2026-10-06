-- =====================================================================
-- ELVIRA — one-shot, safe-to-repeat database fix (v4 + v5 pieces).
-- Paste ALL of this in Supabase -> SQL Editor -> New query -> Run.
-- The last result must say "No rows returned" (= nothing is missing).
-- =====================================================================

-- ---- purchases: sale details + pay-in-new-tab flow ----
alter table purchases add column if not exists order_code text;
alter table purchases add column if not exists customer_email text;
alter table purchases add column if not exists subtotal_eur numeric(10,2) not null default 0;
alter table purchases add column if not exists payment_gateway text;
alter table purchases add column if not exists payment_apm text;
alter table purchases add column if not exists provider text not null default 'shoppex';
alter table purchases add column if not exists provider_invoice_id text;
alter table purchases add column if not exists offers jsonb not null default '[]'::jsonb;
alter table purchases add column if not exists paid_at timestamptz;
alter table purchases add column if not exists failure_reason text;
alter table purchases add column if not exists delivery_status text not null default 'none';
alter table purchases add column if not exists buyer_ip text;
alter table purchases add column if not exists events jsonb not null default '[]'::jsonb;
alter table purchases add column if not exists last_seen_at timestamptz not null default now();
alter table purchases add column if not exists expires_at timestamptz;
alter table purchases add column if not exists failure_code integer;
alter table purchases add column if not exists terms_accepted_at timestamptz;
alter table purchases add column if not exists order_ip_changed boolean not null default false;
create unique index if not exists purchases_order_code_idx on purchases (order_code) where order_code is not null;
create index if not exists purchases_provider_invoice_idx on purchases (provider_invoice_id);
create index if not exists purchases_created_idx on purchases (created_at desc);
create index if not exists purchases_ip_code_idx on purchases (buyer_ip, discount_code);
create index if not exists purchases_pending_idx on purchases (status, last_seen_at);

-- ---- promotions: end date ----
alter table promotions add column if not exists ends_at timestamptz;

-- ---- payment secrets / webhook de-duplication / download tokens ----
create table if not exists order_secrets (
  purchase_id uuid primary key references purchases (id) on delete cascade,
  webhook_secret text not null,
  provider_invoice_id text,
  pay_url text,
  fingerprint text,
  created_at timestamptz not null default now()
);
alter table order_secrets enable row level security;

create table if not exists processed_webhooks (
  delivery_id text primary key,
  purchase_id uuid,
  event text,
  created_at timestamptz not null default now()
);
alter table processed_webhooks enable row level security;

create table if not exists download_tokens (
  token_hash text primary key,
  user_id uuid not null references users (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  license_id uuid references licenses (id) on delete cascade,
  expires_at timestamptz not null,
  used_count integer not null default 0,
  last_ip text,
  created_by text not null default 'web',
  created_at timestamptz not null default now()
);
create index if not exists download_tokens_expires_idx on download_tokens (expires_at);
alter table download_tokens enable row level security;

-- ---- bot queue ----
create table if not exists bot_events (
  id bigint generated always as identity primary key,
  kind text not null,
  purchase_id uuid references purchases (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  attempts integer not null default 0,
  last_error text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table bot_events add column if not exists payload jsonb not null default '{}'::jsonb;
alter table bot_events alter column purchase_id drop not null;
create index if not exists bot_events_pending_idx on bot_events (status, created_at);
alter table bot_events enable row level security;

do $$
begin
  alter table bot_events drop constraint if exists bot_events_kind_check;
  alter table bot_events add constraint bot_events_kind_check
    check (kind in ('sale_complete', 'sale_failed', 'sale_started', 'license_received', 'security_alert', 'download_log'));
exception when others then
  raise notice 'kind check skipped: %', sqlerrm;
end $$;

-- ---- bot settings (Management Area -> Bot Configuration) ----
create table if not exists bot_settings (
  id text primary key default 'main',
  embeds jsonb not null default '{}'::jsonb,
  presence jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table bot_settings enable row level security;

revoke all on all tables in schema public from anon, authenticated;

-- ---- make the API see the new tables/columns right now ----
notify pgrst, 'reload schema';

-- ---- CHECK: this must return NO ROWS. Any row = something is still missing ----
with need(t, c) as (values
  ('purchases','order_code'),('purchases','customer_email'),('purchases','subtotal_eur'),('purchases','buyer_ip'),
  ('purchases','last_seen_at'),('purchases','expires_at'),('purchases','failure_code'),('purchases','terms_accepted_at'),
  ('purchases','order_ip_changed'),('purchases','events'),('purchases','provider'),('promotions','ends_at'),
  ('bot_events','payload'),('bot_settings','id'),('order_secrets','webhook_secret'),
  ('processed_webhooks','delivery_id'),('download_tokens','token_hash'))
select t as missing_table, c as missing_column from need
where not exists (select 1 from information_schema.columns x where x.table_schema = 'public' and x.table_name = need.t and x.column_name = need.c);
