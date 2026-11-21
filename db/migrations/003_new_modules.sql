-- ======================================================================
-- New modules: cash count, messages, pledges (sankalp), budgets, online
-- payments, bookings (hall / room), seva booking, inventory, assets,
-- staff & salary, error log, donor portal, 2-step login.
-- Same table shape as 001 (id, data jsonb, created_at, updated_at).
-- ======================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cash_counts','message_logs','pledges','budgets','online_payments',
    'booking_resources','bookings','seva_types','seva_bookings',
    'inventory_items','stock_moves','assets','staff','payslips','error_logs'
  ] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I (
      id text PRIMARY KEY,
      data jsonb NOT NULL DEFAULT ''{}''::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_touch', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION tm_touch()', t || '_touch', t);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS cash_counts_date ON cash_counts ((data->'accountId'), (data->'date') DESC);
CREATE INDEX IF NOT EXISTS message_logs_at ON message_logs ((data->'createdAt') DESC);
CREATE INDEX IF NOT EXISTS message_logs_ref ON message_logs ((data->'refId'));
CREATE INDEX IF NOT EXISTS pledges_donor ON pledges ((data->'donorId'));
CREATE INDEX IF NOT EXISTS pledges_due ON pledges ((data->'status'), (data->'nextDue'));
CREATE INDEX IF NOT EXISTS budgets_fy ON budgets ((data->'financialYearId'));
CREATE INDEX IF NOT EXISTS online_payments_status ON online_payments ((data->'status'), (data->'createdAt') DESC);
CREATE INDEX IF NOT EXISTS online_payments_order ON online_payments ((data->'orderId'));
CREATE INDEX IF NOT EXISTS bookings_res_date ON bookings ((data->'resourceId'), (data->'fromDate'));
CREATE INDEX IF NOT EXISTS bookings_status ON bookings ((data->'status'), (data->'fromDate') DESC);
CREATE INDEX IF NOT EXISTS seva_bookings_date ON seva_bookings ((data->'sevaDate'), (data->'status'));
CREATE INDEX IF NOT EXISTS stock_moves_item ON stock_moves ((data->'itemId'), (data->'date') DESC);
CREATE INDEX IF NOT EXISTS payslips_month ON payslips ((data->'month'), (data->'staffId'));
CREATE INDEX IF NOT EXISTS error_logs_at ON error_logs ((data->'at') DESC);

-- donor portal (OTP login) – server-only tables
CREATE TABLE IF NOT EXISTS donor_otps (
  id text PRIMARY KEY,               -- random
  channel_key text NOT NULL,         -- mobile or email (normalised)
  code_hash text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS donor_otps_key ON donor_otps (channel_key, created_at DESC);
CREATE TABLE IF NOT EXISTS donor_sessions (
  token_hash text PRIMARY KEY,
  channel_key text NOT NULL,
  donor_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- 2-step login (authenticator app)
ALTER TABLE user_credentials ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE user_credentials ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE user_credentials ADD COLUMN IF NOT EXISTS recovery_codes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pending_2fa boolean NOT NULL DEFAULT false;
