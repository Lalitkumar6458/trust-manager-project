-- ======================================================================
-- Trust Manager – PostgreSQL schema
--
-- Every business table has the same shape:
--   id          text primary key
--   data        jsonb  – the record (all fields, exactly as the app uses them)
--   created_at / updated_at
-- Frequently filtered / sorted fields have expression indexes, so every
-- filter, search and sort runs inside PostgreSQL (no full-table loads).
-- Money integrity (balances, ledger, period locks) is enforced by the server
-- code inside SQL transactions; the browser never writes to the database.
-- ======================================================================

CREATE OR REPLACE FUNCTION tm_touch() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'settings','counters','users','trustees','donors','beneficiaries','accounts','funds',
    'donation_categories','expense_categories','donations','expenses','transactions',
    'bank_statements','statement_lines','monthly_closings','financial_years','reports',
    'audit_logs','documents','notifications','roles','stats'
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

-- ---------------- logins ----------------
CREATE TABLE IF NOT EXISTS user_credentials (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  must_change boolean NOT NULL DEFAULT false,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ip text,
  user_agent text
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

-- ---------------- donations ----------------
CREATE INDEX IF NOT EXISTS donations_fy_date ON donations ((data->'financialYearId'), (data->'date') DESC);
CREATE INDEX IF NOT EXISTS donations_fy_status_date ON donations ((data->'financialYearId'), (data->'status'), (data->'date') DESC);
CREATE INDEX IF NOT EXISTS donations_donor ON donations ((data->'donorId'), (data->'date') DESC);
CREATE INDEX IF NOT EXISTS donations_amount ON donations ((data->'financialYearId'), (data->'amount') DESC);
CREATE INDEX IF NOT EXISTS donations_kw ON donations USING gin ((data->'searchKeywords') jsonb_path_ops);
CREATE INDEX IF NOT EXISTS donations_cats ON donations USING gin ((data->'categoryIds') jsonb_path_ops);
CREATE INDEX IF NOT EXISTS donations_funds ON donations USING gin ((data->'fundIds') jsonb_path_ops);
CREATE INDEX IF NOT EXISTS donations_void ON donations ((data->'voidDate'));

-- ---------------- expenses ----------------
CREATE INDEX IF NOT EXISTS expenses_fy_date ON expenses ((data->'financialYearId'), (data->'date') DESC);
CREATE INDEX IF NOT EXISTS expenses_fy_status_date ON expenses ((data->'financialYearId'), (data->'status'), (data->'date') DESC);
CREATE INDEX IF NOT EXISTS expenses_payee ON expenses ((data->'payeeId'), (data->'date') DESC);
CREATE INDEX IF NOT EXISTS expenses_fund ON expenses ((data->'fundId'));
CREATE INDEX IF NOT EXISTS expenses_amount ON expenses ((data->'financialYearId'), (data->'amount') DESC);
CREATE INDEX IF NOT EXISTS expenses_kw ON expenses USING gin ((data->'searchKeywords') jsonb_path_ops);
CREATE INDEX IF NOT EXISTS expenses_void ON expenses ((data->'voidDate'));
CREATE INDEX IF NOT EXISTS expenses_paid ON expenses ((data->'paidDate'));

-- ---------------- ledger ----------------
CREATE INDEX IF NOT EXISTS txn_fy_date ON transactions ((data->'financialYearId'), (data->'date') DESC, (data->'createdAt') DESC);
CREATE INDEX IF NOT EXISTS txn_fy_acct_date ON transactions ((data->'financialYearId'), (data->'accountId'), (data->'date'), (data->'createdAt'));
CREATE INDEX IF NOT EXISTS txn_acct_date ON transactions ((data->'accountId'), (data->'date'));
CREATE INDEX IF NOT EXISTS txn_source ON transactions ((data->'sourceId'));
CREATE INDEX IF NOT EXISTS txn_kw ON transactions USING gin ((data->'searchKeywords') jsonb_path_ops);

-- ---------------- people ----------------
CREATE INDEX IF NOT EXISTS donors_total ON donors ((data->'totalAmount') DESC);
CREATE INDEX IF NOT EXISTS donors_kw ON donors USING gin ((data->'searchKeywords') jsonb_path_ops);
CREATE INDEX IF NOT EXISTS donors_mobile ON donors ((data->'mobile'));
CREATE INDEX IF NOT EXISTS donors_pan ON donors ((data->'pan'));
CREATE INDEX IF NOT EXISTS benef_type_total ON beneficiaries ((data->'type'), (data->'totalAmount') DESC);
CREATE INDEX IF NOT EXISTS benef_kw ON beneficiaries USING gin ((data->'searchKeywords') jsonb_path_ops);

-- ---------------- others ----------------
CREATE INDEX IF NOT EXISTS audit_at ON audit_logs ((data->'at') DESC);
CREATE INDEX IF NOT EXISTS audit_doc ON audit_logs ((data->'docId'), (data->'at') DESC);
CREATE INDEX IF NOT EXISTS audit_kw ON audit_logs USING gin ((data->'searchKeywords') jsonb_path_ops);
CREATE INDEX IF NOT EXISTS documents_fy ON documents ((data->'financialYearId'), (data->'createdAt') DESC);
CREATE INDEX IF NOT EXISTS documents_linked ON documents ((data->'linkedId'));
CREATE INDEX IF NOT EXISTS documents_kw ON documents USING gin ((data->'searchKeywords') jsonb_path_ops);
CREATE INDEX IF NOT EXISTS lines_stmt ON statement_lines ((data->'statementId'), (data->'seq'));
CREATE INDEX IF NOT EXISTS notif_created ON notifications ((data->'createdAt') DESC);
CREATE INDEX IF NOT EXISTS notif_roles ON notifications USING gin ((data->'roles') jsonb_path_ops);
CREATE INDEX IF NOT EXISTS stmt_fy ON bank_statements ((data->'financialYearId'));
