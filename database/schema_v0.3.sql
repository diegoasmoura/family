-- =====================================================================
-- App de Finanças (casal) — modelo de dados v0.3
-- Portável entre SQLite (desenvolvimento) e PostgreSQL (NAS).
--
-- Convenções:
--   * Dinheiro SEMPRE em centavos (INTEGER). Nunca REAL.
--   * Datas em texto ISO 'YYYY-MM-DD'; competência 'YYYY-MM';
--     timestamps em ISO 8601 gravados pela aplicação.
--   * Toda tabela de negócio pertence a um household.
--   * Flags booleanas em INTEGER 0/1.
--   * client_uuid + updated_at + deleted_at preparam o sync offline.
--   * "id INTEGER PRIMARY KEY" vira identity no PostgreSQL (migrate.ts).
--
-- Regras de produto que este schema não consegue impor sozinho e
-- ficam no domínio/API:
--   * categoria filha no mesmo household e mesmo kind do pai;
--   * total da fatura = soma das compras; pago = soma dos pagamentos;
--   * saldo de conta é sempre derivado, nunca armazenado.
-- =====================================================================

-- ---------- Domicílio e usuários ----------
CREATE TABLE households (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  timezone    TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at  TEXT NOT NULL
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  household_id  INTEGER NOT NULL REFERENCES households(id),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_users_household ON users (household_id);

-- ---------- Contas (onde o dinheiro está) ----------
CREATE TABLE accounts (
  id                    INTEGER PRIMARY KEY,
  client_uuid           TEXT NOT NULL UNIQUE,
  household_id          INTEGER NOT NULL REFERENCES households(id),
  name                  TEXT NOT NULL,
  type                  TEXT NOT NULL CHECK (type IN ('checking','savings','cash','wallet','investment')),
  initial_balance_cents INTEGER NOT NULL DEFAULT 0,
  initial_balance_on    TEXT NOT NULL,
  archived              INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  deleted_at            TEXT
);
CREATE INDEX idx_accounts_household ON accounts (household_id);

-- ---------- Cartões de crédito ----------
CREATE TABLE credit_cards (
  id                     INTEGER PRIMARY KEY,
  client_uuid            TEXT NOT NULL UNIQUE,
  household_id           INTEGER NOT NULL REFERENCES households(id),
  name                   TEXT NOT NULL,
  brand                  TEXT,
  closing_day            INTEGER NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day                INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  limit_cents            INTEGER CHECK (limit_cents IS NULL OR limit_cents >= 0),
  default_pay_account_id INTEGER REFERENCES accounts(id),
  archived               INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  deleted_at             TEXT
);
CREATE INDEX idx_cards_household ON credit_cards (household_id);

-- Uma fatura por cartão por mês. reference_month = mês em que ela VENCE.
-- Não guarda total nem valor pago: o total vem das compras vinculadas
-- e o pago vem de invoice_payments.
CREATE TABLE invoices (
  id               INTEGER PRIMARY KEY,
  card_id          INTEGER NOT NULL REFERENCES credit_cards(id),
  reference_month  TEXT NOT NULL,
  closing_date     TEXT NOT NULL,
  due_date         TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (card_id, reference_month)
);

-- Pagamentos parciais, integrais e antecipados. Pagamento é caixa:
-- reduz o saldo da conta e nunca cria despesa.
CREATE TABLE invoice_payments (
  id            INTEGER PRIMARY KEY,
  client_uuid   TEXT NOT NULL UNIQUE,
  invoice_id    INTEGER NOT NULL REFERENCES invoices(id),
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_on       TEXT NOT NULL,
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_invoice_payments_invoice ON invoice_payments (invoice_id);
CREATE INDEX idx_invoice_payments_account ON invoice_payments (account_id);

-- ---------- Categorias (hierarquia pai/filho) ----------
CREATE TABLE categories (
  id            INTEGER PRIMARY KEY,
  client_uuid   TEXT NOT NULL UNIQUE,
  household_id  INTEGER NOT NULL REFERENCES households(id),
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('income','expense')),
  parent_id     INTEGER REFERENCES categories(id),
  icon          TEXT,
  color         TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  archived      INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX idx_categories_household ON categories (household_id);

-- ---------- Parcelamentos: em cartão OU em conta ----------
CREATE TABLE installment_plans (
  id            INTEGER PRIMARY KEY,
  client_uuid   TEXT NOT NULL UNIQUE,
  household_id  INTEGER NOT NULL REFERENCES households(id),
  description   TEXT NOT NULL,
  total_cents   INTEGER NOT NULL CHECK (total_cents > 0),
  installments  INTEGER NOT NULL CHECK (installments >= 2),
  card_id       INTEGER REFERENCES credit_cards(id),
  account_id    INTEGER REFERENCES accounts(id),
  category_id   INTEGER REFERENCES categories(id),
  purchased_on  TEXT NOT NULL,
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  CHECK ((card_id IS NOT NULL) <> (account_id IS NOT NULL))
);

-- ---------- Recorrências ----------
CREATE TABLE recurrences (
  id            INTEGER PRIMARY KEY,
  client_uuid   TEXT NOT NULL UNIQUE,
  household_id  INTEGER NOT NULL REFERENCES households(id),
  kind          TEXT NOT NULL CHECK (kind IN ('income','expense')),
  description   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  category_id   INTEGER REFERENCES categories(id),
  account_id    INTEGER REFERENCES accounts(id),
  card_id       INTEGER REFERENCES credit_cards(id),
  day_of_month  INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  start_month   TEXT NOT NULL,
  end_month     TEXT,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  CHECK ((account_id IS NOT NULL) <> (card_id IS NOT NULL)),
  CHECK (kind = 'expense' OR card_id IS NULL),
  CHECK (end_month IS NULL OR end_month >= start_month)
);

-- ---------- Lançamentos (coração do app) ----------
CREATE TABLE transactions (
  id                 INTEGER PRIMARY KEY,
  client_uuid        TEXT NOT NULL UNIQUE,
  household_id       INTEGER NOT NULL REFERENCES households(id),
  kind               TEXT NOT NULL CHECK (kind IN ('income','expense')),
  description        TEXT NOT NULL DEFAULT '',
  amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),
  occurred_on        TEXT NOT NULL,
  due_on             TEXT,
  paid_on            TEXT,
  competence_month   TEXT NOT NULL,
  category_id        INTEGER REFERENCES categories(id),
  account_id         INTEGER REFERENCES accounts(id),
  card_id            INTEGER REFERENCES credit_cards(id),
  invoice_id         INTEGER REFERENCES invoices(id),
  plan_id            INTEGER REFERENCES installment_plans(id),
  installment_no     INTEGER,
  recurrence_id      INTEGER REFERENCES recurrences(id),
  status             TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('planned','posted')),
  include_in_reports INTEGER NOT NULL DEFAULT 1 CHECK (include_in_reports IN (0,1)),
  overridden         INTEGER NOT NULL DEFAULT 0 CHECK (overridden IN (0,1)),
  created_by         INTEGER NOT NULL REFERENCES users(id),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT,
  -- Ou vai numa conta, ou num cartão. Nunca nos dois, nunca em nenhum.
  CHECK ((account_id IS NOT NULL) <> (card_id IS NOT NULL)),
  -- Receita não vai em cartão.
  CHECK (kind = 'expense' OR card_id IS NULL),
  -- Compra no cartão sempre pertence a uma fatura; lançamento em conta nunca.
  CHECK ((card_id IS NOT NULL) = (invoice_id IS NOT NULL)),
  -- Em conta, efetivado (posted) é exatamente ter data de pagamento.
  CHECK (card_id IS NOT NULL OR (status = 'posted') = (paid_on IS NOT NULL)),
  CHECK ((plan_id IS NULL) = (installment_no IS NULL)),
  CHECK (installment_no IS NULL OR installment_no >= 1)
);

CREATE INDEX idx_tx_household_month ON transactions (household_id, competence_month) WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_category        ON transactions (category_id, competence_month) WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_account         ON transactions (account_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_invoice         ON transactions (invoice_id);
CREATE UNIQUE INDEX uq_tx_plan_installment   ON transactions (plan_id, installment_no) WHERE deleted_at IS NULL AND plan_id IS NOT NULL;
CREATE UNIQUE INDEX uq_tx_recurrence_month   ON transactions (recurrence_id, competence_month) WHERE deleted_at IS NULL AND recurrence_id IS NOT NULL;

-- Transferência entre contas NÃO é receita nem despesa.
CREATE TABLE transfers (
  id              INTEGER PRIMARY KEY,
  client_uuid     TEXT NOT NULL UNIQUE,
  household_id    INTEGER NOT NULL REFERENCES households(id),
  from_account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  occurred_on     TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT,
  CHECK (from_account_id <> to_account_id)
);
CREATE INDEX idx_transfers_household ON transfers (household_id, occurred_on);

-- ---------- Orçamento e metas ----------
CREATE TABLE budgets (
  id            INTEGER PRIMARY KEY,
  client_uuid   TEXT NOT NULL UNIQUE,
  household_id  INTEGER NOT NULL REFERENCES households(id),
  category_id   INTEGER NOT NULL REFERENCES categories(id),
  month         TEXT NOT NULL,
  planned_cents INTEGER NOT NULL CHECK (planned_cents >= 0),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (category_id, month)
);

CREATE TABLE goals (
  id            INTEGER PRIMARY KEY,
  client_uuid   TEXT NOT NULL UNIQUE,
  household_id  INTEGER NOT NULL REFERENCES households(id),
  name          TEXT NOT NULL,
  target_cents  INTEGER NOT NULL CHECK (target_cents > 0),
  saved_cents   INTEGER NOT NULL DEFAULT 0 CHECK (saved_cents >= 0),
  deadline      TEXT,
  completed_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);

-- ---------- Gamificação ----------
-- Fonte da verdade: eventos de XP. Nível e totais são derivados.
-- ref_key torna idempotentes os eventos que só valem uma vez
-- (ex.: 'tx:42', 'month:2026-10', 'week:2026-W41').
CREATE TABLE xp_events (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL CHECK (type IN ('tx_logged','week_review','month_closed','mission_done','goal_done')),
  xp          INTEGER NOT NULL,
  ref_id      INTEGER,
  ref_key     TEXT,
  activity_on TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_xp_user ON xp_events (user_id, created_at);
CREATE UNIQUE INDEX uq_xp_ref ON xp_events (user_id, type, ref_key) WHERE ref_key IS NOT NULL;

CREATE TABLE streaks (
  user_id            INTEGER NOT NULL PRIMARY KEY REFERENCES users(id),
  current_days       INTEGER NOT NULL DEFAULT 0,
  longest_days       INTEGER NOT NULL DEFAULT 0,
  last_activity_date TEXT
);

CREATE TABLE achievements (
  code         TEXT NOT NULL PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL
);

CREATE TABLE user_achievements (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  code         TEXT NOT NULL REFERENCES achievements(code),
  unlocked_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, code)
);

CREATE TABLE missions (
  id            INTEGER PRIMARY KEY,
  household_id  INTEGER NOT NULL REFERENCES households(id),
  month         TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('stay_under_budget','log_every_day','save_target')),
  category_id   INTEGER REFERENCES categories(id),
  target        INTEGER NOT NULL,
  progress      INTEGER NOT NULL DEFAULT 0,
  xp_reward     INTEGER NOT NULL DEFAULT 50,
  completed_at  TEXT,
  UNIQUE (household_id, month, type)
);

INSERT INTO achievements (code, name, description) VALUES
  ('first_tx',       'Primeiro lançamento', 'Registrou o primeiro lançamento'),
  ('streak_7',       'Uma semana seguida',  'Registrou atividade 7 dias seguidos'),
  ('streak_30',      'Um mês seguido',      'Registrou atividade 30 dias seguidos'),
  ('month_balanced', 'Mês no azul',         'Fechou um mês com receitas maiores ou iguais às despesas'),
  ('budget_master',  'Dentro do orçamento', 'Concluiu a missão de ficar abaixo do orçamento'),
  ('first_goal',     'Meta batida',         'Concluiu a primeira meta');
