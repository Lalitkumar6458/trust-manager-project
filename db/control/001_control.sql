-- Owner control panel database (multi-sanstha / SaaS mode).
-- One row per sanstha; each sanstha's own data lives in its own database (tenants.db_name).

CREATE TABLE IF NOT EXISTS plans (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_month numeric,                 -- NULL = no monthly option
  price_year  numeric,
  features    text[] NOT NULL DEFAULT '{}',
  max_users   int,                     -- NULL = unlimited
  sort        int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenants (
  id          text PRIMARY KEY,
  slug        text NOT NULL UNIQUE,            -- web address: <slug>.<TENANT_BASE_DOMAIN>
  name        text NOT NULL,
  hosts       text[] NOT NULL DEFAULT '{}',    -- extra / custom domains
  db_name     text NOT NULL UNIQUE,
  plan_id     text REFERENCES plans(id),
  features    jsonb NOT NULL DEFAULT '{}'::jsonb, -- { add: [], remove: [] } on top of the plan
  max_users   int,                             -- NULL = plan limit
  price_month numeric,                         -- NULL = plan price (special price for this sanstha)
  price_year  numeric,
  status      text NOT NULL DEFAULT 'active',  -- active | suspended
  trial       boolean NOT NULL DEFAULT false,
  starts_on   date,
  expires_on  date,                            -- NULL = no expiry (lifetime)
  grace_days  int NOT NULL DEFAULT 7,
  contact     jsonb NOT NULL DEFAULT '{}'::jsonb, -- { person, mobile, email, city, gst }
  notes       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS tenants_hosts_idx ON tenants USING gin (hosts);

CREATE TABLE IF NOT EXISTS payments (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id),
  amount      numeric NOT NULL,
  method      text NOT NULL DEFAULT '',        -- Cash, UPI, Bank, Cheque, Razorpay …
  reference   text NOT NULL DEFAULT '',
  plan_id     text,
  months      int NOT NULL DEFAULT 0,
  period_from date,
  period_to   date,
  note        text NOT NULL DEFAULT '',
  source      text NOT NULL DEFAULT 'manual',  -- manual | razorpay
  order_id    text UNIQUE,
  receipt_no  text,
  created_by  text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  voided_at   timestamptz,
  void_reason text
);
CREATE INDEX IF NOT EXISTS payments_tenant_idx ON payments (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS renew_orders (
  order_id    text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id),
  plan_id     text,
  months      int NOT NULL,
  amount      numeric NOT NULL,
  status      text NOT NULL DEFAULT 'created',  -- created | paid
  payment_id  text,
  created_by  text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  paid_at     timestamptz
);

CREATE TABLE IF NOT EXISTS owners (
  id              text PRIMARY KEY,
  email           text NOT NULL UNIQUE,
  name            text NOT NULL DEFAULT '',
  password_hash   text NOT NULL,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS owner_sessions (
  token_hash  text PRIMARY KEY,
  owner_id    text NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  last_seen   timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control_settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS control_secrets (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS control_audit (
  id        bigserial PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  actor     text NOT NULL DEFAULT '',
  action    text NOT NULL,
  tenant_id text,
  detail    jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS counters (
  key   text PRIMARY KEY,
  value bigint NOT NULL DEFAULT 0
);

-- suggested starting plans (edit prices / features in Control panel → Plans)
INSERT INTO plans (id, name, description, price_month, price_year, features, max_users, sort) VALUES
  ('basic', 'Basic', 'Small temple / trust – donations, receipts, expenses, books and reports', 499, 4999, '{}', 3, 1),
  ('standard', 'Standard', 'Growing trust – adds messages, sankalp, bank reconciliation, budget, 80G filing, Tally', 999, 9999,
    '{pledges,messaging,reconciliation,budget,form10bd,tally}', 8, 2),
  ('premium', 'Premium', 'Large sansthan – everything incl. online donation, donor portal, seva, hall booking, store, assets, salary', 1799, 17999,
    '{pledges,messaging,reconciliation,budget,form10bd,tally,online,portal,seva,bookings,inventory,assets,payroll}', NULL, 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO control_settings (key, value) VALUES
  ('brand_name', '"Trust Manager"'), ('warn_days', '15'), ('default_grace_days', '7'), ('support_phone', '""'), ('support_email', '""'),
  ('online_renewal', 'true')
ON CONFLICT (key) DO NOTHING;
