-- Run this once in Supabase → SQL Editor → New query → Run.

create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  discord_id text unique not null,
  discord_username text not null,
  email text,
  avatar_url text,
  roblox_id text,
  roblox_username text,
  created_at timestamptz default now()
);

create unique index if not exists users_roblox_id_idx on users (roblox_id) where roblox_id is not null;

-- One active verification code per Discord user (the Roblox game redeems it).
create table if not exists verification_codes (
  discord_id text primary key references users (discord_id) on delete cascade,
  code text not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

create index if not exists verification_codes_code_idx on verification_codes (code);

-- ---------- Admin accounts ----------
alter table users add column if not exists is_admin boolean not null default false;

-- ---------- Hub information screen (Roblox game announcement) ----------
-- Single row (id = 1) holding the message shown on Roblox before the
-- verification flow, editable from the dashboard's "Administrator Features".
create table if not exists hub_info (
  id int primary key default 1 check (id = 1),
  title text not null default '',
  message text not null default '',
  require_ack boolean not null default true,
  active boolean not null default false,
  updated_at timestamptz default now()
);

insert into hub_info (id) values (1) on conflict (id) do nothing;

-- Mark the two existing admin accounts. Run this AFTER they have logged in
-- with Discord at least once (so the row exists) — linking Roblox is not
-- required, since email is the most reliable identifier (usernames can change).
update users
set is_admin = true
where lower(discord_username) in ('barbiedoll4', 'iconicutie')
   or lower(roblox_username) in ('0_progirl', 'iconicutie');


-- =====================================================================
-- v2 — roles, blocking, products, licenses, purchases, promotions,
--      website settings and file storage.
-- Everything below is safe to run more than once.
-- =====================================================================

-- ---------- Users: pre-created accounts, roles, blocking ----------
-- discord_id can be empty for accounts an admin creates by hand; the person
-- claims the account the first time they log in with that Discord username.
alter table users alter column discord_id drop not null;

alter table users add column if not exists role text not null default 'customer';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_role_check') then
    alter table users add constraint users_role_check check (role in ('customer', 'staff', 'admin'));
  end if;
end $$;
update users set role = 'admin' where is_admin = true and role <> 'admin';

alter table users add column if not exists blocked boolean not null default false;
alter table users add column if not exists blocked_reason text;
alter table users add column if not exists blocked_at timestamptz;

-- ---------- Products ----------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  media jsonb not null default '[]'::jsonb,
  description_html text not null default '',
  category text not null default '',
  extra_details text not null default '',
  price_eur numeric(10,2) not null default 0,
  discount_type text not null default 'none' check (discount_type in ('none', 'percent', 'amount')),
  discount_value numeric(10,2) not null default 0,
  price_robux integer,
  discount_robux_type text not null default 'none' check (discount_robux_type in ('none', 'percent', 'amount')),
  discount_robux_value numeric(10,2) not null default 0,
  deliverables jsonb not null default '[]'::jsonb,
  delivery_link text not null default '',
  label text not null default '',
  status text not null default 'public' check (status in ('private', 'public', 'unlisted')),
  instructions_html text not null default '',
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_status_published_idx on products (status, published_at desc);

-- ---------- Purchases ----------
-- Checkout is not built yet; this table is what the future checkout writes to
-- and what "View history" in the Management Area reads.
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity,
  user_id uuid references users (id) on delete set null,
  buyer_discord text,
  status text not null default 'pending' check (status in ('paid', 'unpaid', 'pending', 'error', 'incomplete')),
  amount_eur numeric(10,2) not null default 0,
  currency text not null default 'EUR',
  payment_method text,
  discount_code text,
  discount_amount numeric(10,2) not null default 0,
  points_used integer not null default 0,
  items jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists purchases_order_number_idx on purchases (order_number);
create index if not exists purchases_user_idx on purchases (user_id, created_at desc);

-- ---------- Licenses ----------
create table if not exists licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  product_id uuid references products (id) on delete set null,
  product_name text not null,
  purchase_id uuid references purchases (id) on delete set null,
  order_number bigint,
  source text not null default 'purchase' check (source in ('purchase', 'gift', 'transfer')),
  granted_by text,
  transferred_from text,
  transferred_at timestamptz,
  acquired_at timestamptz not null default now()
);
create index if not exists licenses_user_idx on licenses (user_id);
create unique index if not exists licenses_user_product_idx on licenses (user_id, product_id) where product_id is not null;

-- ---------- Promotions ----------
create table if not exists promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('coupon', 'buy_get', 'first_purchase', 'min_spend')),
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Website settings (status bar + information window) ----------
create table if not exists site_settings (
  id int primary key default 1 check (id = 1),
  status_bar jsonb not null default '{}'::jsonb,
  info_window jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
insert into site_settings (id) values (1) on conflict (id) do nothing;

-- ---------- Paid-purchase counter used by the user list ----------
create or replace view user_purchase_counts with (security_invoker = true) as
  select user_id, count(*) as paid_count
  from purchases
  where status = 'paid' and user_id is not null
  group by user_id;

-- ---------- Security: nobody can read these tables with the public API key ----------
-- The website only talks to the database through the server (service role,
-- which bypasses RLS). Turning RLS on with no policies blocks everyone else.
alter table users enable row level security;
alter table verification_codes enable row level security;
alter table hub_info enable row level security;
alter table products enable row level security;
alter table purchases enable row level security;
alter table licenses enable row level security;
alter table promotions enable row level security;
alter table site_settings enable row level security;

-- ---------- File storage ----------
-- product-media : public   (images/videos shown in the store)
-- product-files : private  (files a customer receives after buying)
insert into storage.buckets (id, name, public) values ('product-media', 'product-media', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('product-files', 'product-files', false) on conflict (id) do nothing;

-- ---------- Make sure the two original admins keep their role ----------
-- Safe to run anytime; does nothing if these accounts don't exist yet.
update users set role = 'admin', is_admin = true
  where discord_username ilike 'iconicutie' or discord_username ilike 'barbiedoll4';


-- ---------- Audit log of admin actions (optional but recommended) ----------
create table if not exists admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid,
  admin_name text,
  action text not null,
  target text,
  created_at timestamptz not null default now()
);
alter table admin_audit_log enable row level security;

-- ---------- Extra hardening: the browser (anon/authenticated keys) can never touch these ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;


-- =====================================================================
-- v4 — checkout (Shoppex), sales, secure downloads, Elvire bot queue.
-- Safe to run more than once.
-- =====================================================================

-- ---------- Purchases: everything about a sale ----------
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
create unique index if not exists purchases_order_code_idx on purchases (order_code) where order_code is not null;
create index if not exists purchases_provider_invoice_idx on purchases (provider_invoice_id);
create index if not exists purchases_created_idx on purchases (created_at desc);

-- ---------- Secrets of each payment (never readable by the browser) ----------
create table if not exists order_secrets (
  purchase_id uuid primary key references purchases (id) on delete cascade,
  webhook_secret text not null,
  provider_invoice_id text,
  pay_url text,
  fingerprint text,
  created_at timestamptz not null default now()
);
alter table order_secrets enable row level security;

-- ---------- Webhook de-duplication (Shoppex can deliver twice) ----------
create table if not exists processed_webhooks (
  delivery_id text primary key,
  purchase_id uuid,
  event text,
  created_at timestamptz not null default now()
);
alter table processed_webhooks enable row level security;

-- ---------- One-time-ish download tokens (only the SHA-256 hash is stored) ----------
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

-- ---------- Queue read by the Elvire Discord bot ----------
create table if not exists bot_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('sale_complete', 'sale_failed')),
  purchase_id uuid not null references purchases (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  attempts integer not null default 0,
  last_error text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists bot_events_pending_idx on bot_events (status, created_at);
alter table bot_events enable row level security;

-- ---------- Housekeeping: delete expired download tokens (call from a cron if you like) ----------
create or replace function purge_expired_download_tokens() returns void
language sql security definer set search_path = public as
$$ delete from download_tokens where expires_at < now() - interval '1 day'; $$;
revoke all on function purge_expired_download_tokens() from public, anon, authenticated;

-- ---------- Extra hardening for the new tables ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;


-- =====================================================================
-- v5 — pay-in-new-tab flow, error codes, promo end dates, bot settings,
--       security alerts / download logs / license-received queue.
-- Safe to run more than once.
-- =====================================================================
alter table purchases add column if not exists last_seen_at timestamptz not null default now();
alter table purchases add column if not exists expires_at timestamptz;
alter table purchases add column if not exists failure_code integer;
alter table purchases add column if not exists terms_accepted_at timestamptz;
alter table purchases add column if not exists order_ip_changed boolean not null default false;
create index if not exists purchases_ip_code_idx on purchases (buyer_ip, discount_code);
create index if not exists purchases_pending_idx on purchases (status, last_seen_at);

alter table promotions add column if not exists ends_at timestamptz;

alter table bot_events add column if not exists payload jsonb not null default '{}'::jsonb;
alter table bot_events alter column purchase_id drop not null;
alter table bot_events drop constraint if exists bot_events_kind_check;
alter table bot_events add constraint bot_events_kind_check
  check (kind in ('sale_complete', 'sale_failed', 'sale_started', 'license_received', 'security_alert', 'download_log'));

create table if not exists bot_settings (
  id text primary key default 'main',
  embeds jsonb not null default '{}'::jsonb,
  presence jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table bot_settings enable row level security;
revoke all on all tables in schema public from anon, authenticated;


-- Refresh the API schema cache (fixes "could not find the table ... in the schema cache")
notify pgrst, 'reload schema';
