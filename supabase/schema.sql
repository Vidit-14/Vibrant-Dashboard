-- Vibrant Commerce Console — Supabase schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- The app talks to these tables with the service-role key from server-side
-- API routes only, so RLS stays enabled with no public policies.

-- ── auth / access control ────────────────────────────────────────────────
create table if not exists allowed_emails (
  email      text primary key,
  role       text not null default 'member',
  added_by   text,
  added_at   timestamptz not null default now()
);

create table if not exists login_events (
  id         bigint generated always as identity primary key,
  email      text not null,
  ts         timestamptz not null default now(),
  user_agent text
);
create index if not exists login_events_email_ts on login_events (email, ts desc);

-- ── ads dashboard ────────────────────────────────────────────────────────
create table if not exists ad_rows (
  id          bigint generated always as identity primary key,
  country     text not null,
  date        date not null,
  asin        text not null,
  campaign    text not null,
  spend       double precision not null default 0,
  sales       double precision not null default 0,
  orders      double precision not null default 0,
  clicks      double precision not null default 0,
  impressions double precision not null default 0
);
create index if not exists ad_rows_country_date on ad_rows (country, date);
create index if not exists ad_rows_asin on ad_rows (country, asin);

create table if not exists targeting_rows (
  id          bigint generated always as identity primary key,
  country     text not null,
  date        date not null,
  campaign    text not null,
  targeting   text not null default '',
  match_type  text not null default '',
  spend       double precision not null default 0,
  sales       double precision not null default 0,
  orders      double precision not null default 0,
  clicks      double precision not null default 0,
  impressions double precision not null default 0
);
create index if not exists targeting_rows_campaign on targeting_rows (country, campaign, date);

create table if not exists order_rows (
  id      bigint generated always as identity primary key,
  country text not null default 'IND',
  date    date not null,
  sku     text not null default '',
  asin    text not null default '',
  units   double precision not null default 0,
  sales   double precision not null default 0
);
create index if not exists order_rows_asin_date on order_rows (country, asin, date);

create table if not exists change_logs (
  id       bigint generated always as identity primary key,
  ts       timestamptz not null default now(),
  expiry   date,
  asin     text not null default '',
  campaign text not null default '',
  comment  text not null default ''
);
create index if not exists change_logs_ts on change_logs (ts desc);

-- ── return fraud ─────────────────────────────────────────────────────────
create table if not exists fba_returns (
  order_id    text primary key,
  asin        text not null default '',
  disposition text not null default '',
  reason      text not null default '',
  comments    text not null default '',
  return_date date
);
create index if not exists fba_returns_date on fba_returns (return_date);

create table if not exists fulfilled_sales (
  order_id    text primary key,
  date        timestamptz,
  buyer_email text not null default '',
  title       text not null default '',
  pincode     text not null default ''
);

-- ── daily sales tracker ──────────────────────────────────────────────────
create table if not exists business_reports_monthly (
  month text not null,          -- YYYY-MM
  asin  text not null,
  title text not null default '',
  units double precision not null default 0,
  primary key (month, asin)
);

create table if not exists business_reports_daily (
  date  date not null,
  asin  text not null,
  title text not null default '',
  units double precision not null default 0,
  primary key (date, asin)
);

create table if not exists top_asins_monthly_avg (
  month           text not null,  -- YYYY-MM
  asin            text not null,
  title           text not null default '',
  avg_daily_units double precision not null default 0,
  primary key (month, asin)
);

-- ── asin health ──────────────────────────────────────────────────────────
create table if not exists asin_health (
  month    text not null,        -- YYYY-MM
  asin     text not null,
  title    text not null default '',
  sales    double precision not null default 0,
  units    double precision not null default 0,
  sessions double precision not null default 0,
  usp      double precision not null default 0,
  buy_box  double precision not null default 0,
  primary key (month, asin)
);

create table if not exists checklist_status (
  month  text not null,
  asin   text not null,
  item   text not null,
  status boolean not null default false,
  primary key (month, asin, item)
);

-- ── voice of the customer ────────────────────────────────────────────────
create table if not exists voc_snapshots (
  snapshot_date date not null,
  asin          text not null,
  product_name  text not null default '',
  sku           text not null default '',
  ncx_rate      text not null default '',
  ncx_orders    text not null default '',
  total_orders  text not null default '',
  star_rating   text not null default '',
  return_rate   text not null default '',
  top_reason    text not null default '',
  status        text not null default '',
  primary key (snapshot_date, asin)
);

-- ── lock everything down (service-role key bypasses RLS) ─────────────────
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
