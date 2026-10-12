-- =====================================================================
-- App de Finanças (casal) — modelo de dados v0.1 (SQLite)
-- Convenções:
--   * Dinheiro SEMPRE em centavos (INTEGER). Nunca REAL.
--   * Datas em texto ISO: 'YYYY-MM-DD'. Mês de competência: 'YYYY-MM'.
--   * Toda tabela de negócio pertence a um household (domicílio).
--   * Exclusão lógica (deleted_at) nos lançamentos, para o sync offline.
-- =====================================================================
PRAGMA foreign_keys = ON;

-- ---------- Domicílio e usuários ----------
CREATE TABLE households (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  household_id  INTEGER NOT NULL REFERENCES households(id),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Contas (onde o dinheiro está) ----------
CREATE TABLE accounts (
  id                    INTEGER PRIMARY KEY,
  household_id          INTEGER NOT NULL REFERENCES households(id),
  name                  TEXT NOT NULL,
  type                  TEXT NOT NULL CHECK (type IN ('checking','savings','cash','wallet','investment')),
  initial_balance_cents INTEGER NOT NULL DEFAULT 0,
  archived              INTEGER NOT NULL DEFAULT 0
);

-- ---------- Cartões de crédito ----------
CREATE TABLE credit_cards (
  id                 INTEGER PRIMARY KEY,
  household_id       INTEGER NOT NULL REFERENCES households(id),
  name               TEXT NOT NULL,
  closing_day        INTEGER NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day            INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  limit_cents        INTEGER,
  default_pay_account_id INTEGER REFERENCES accounts(id),
  archived           INTEGER NOT NULL DEFAULT 0
);

-- Uma fatura por cartão por mês. 'reference_month' = mês em que ela VENCE
-- (convenção do app; compras após o fechamento caem na fatura seguinte).
CREATE TABLE invoices (
  id                    INTEGER PRIMARY KEY,
  card_id               INTEGER NOT NULL REFERENCES credit_cards(id),
  reference_month       TEXT NOT NULL,            -- 'YYYY-MM'
  closing_date          TEXT NOT NULL,
  due_date              TEXT NOT NULL,
  paid_on               TEXT,                     -- NULL = em aberto
  paid_amount_cents     INTEGER,
  paid_from_account_id  INTEGER REFERENCES accounts(id),
  UNIQUE (card_id, reference_month)
);

-- ---------- Categorias ----------
CREATE TABLE categories (
  id            INTEGER PRIMARY KEY,
  household_id  INTEGER NOT NULL REFERENCES households(id),
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('income','expense')),
  parent_id     INTEGER REFERENCES categories(id),
  icon          TEXT,
  color         TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  archived      INTEGER NOT NULL DEFAULT 0
);

-- ---------- Parcelamentos e recorrências ----------
CREATE TABLE installment_plans (
  id            INTEGER PRIMARY KEY,
  household_id  INTEGER NOT NULL REFERENCES households(id),
  description   TEXT NOT NULL,
  total_cents   INTEGER NOT NULL,
  installments  INTEGER NOT NULL CHECK (installments >= 2),
  card_id       INTEGER NOT NULL REFERENCES credit_cards(id),
  category_id   INTEGER REFERENCES categories(id),
  purchased_on  TEXT NOT NULL,
  created_by    INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE recurrences (
  id            INTEGER PRIMARY KEY,
  household_id  INTEGER NOT NULL REFERENCES households(id),
  kind          TEXT NOT NULL CHECK (kind IN ('income','expense')),
  description   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,
  category_id   INTEGER REFERENCES categories(id),
  account_id    INTEGER REFERENCES accounts(id),
  card_id       INTEGER REFERENCES credit_cards(id),
  day_of_month  INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  start_month   TEXT NOT NULL,                    -- 'YYYY-MM'
  end_month     TEXT,                             -- NULL = sem fim
  active        INTEGER NOT NULL DEFAULT 1,
  created_by    INTEGER NOT NULL REFERENCES users(id),
  CHECK ((account_id IS NOT NULL) <> (card_id IS NOT NULL))
);

-- ---------- Lançamentos (coração do app) ----------
CREATE TABLE transactions (
  id               INTEGER PRIMARY KEY,
  client_uuid      TEXT NOT NULL UNIQUE,          -- gerado no celular; torna o sync offline idempotente
  household_id     INTEGER NOT NULL REFERENCES households(id),
  kind             TEXT NOT NULL CHECK (kind IN ('income','expense')),
  description      TEXT NOT NULL DEFAULT '',
  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),  -- sempre positivo; o sinal vem de 'kind'
  occurred_on      TEXT NOT NULL,                 -- data real da compra/recebimento
  due_on           TEXT,                          -- vencimento (contas fixas); NULL = sem vencimento
  paid_on          TEXT,                          -- quando foi pago/recebido; NULL = pendente
  competence_month TEXT NOT NULL,                 -- mês em que aparece na tabela anual
  category_id      INTEGER REFERENCES categories(id),
  account_id       INTEGER REFERENCES accounts(id),
  card_id          INTEGER REFERENCES credit_cards(id),
  invoice_id       INTEGER REFERENCES invoices(id),
  plan_id          INTEGER REFERENCES installment_plans(id),
  installment_no   INTEGER,
  recurrence_id    INTEGER REFERENCES recurrences(id),
  status           TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('planned','posted')),
  created_by       INTEGER NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at       TEXT,
  -- Ou vai numa conta, ou num cartão. Nunca nos dois, nunca em nenhum.
  CHECK ((account_id IS NOT NULL) <> (card_id IS NOT NULL)),
  -- Receita não vai em cartão.
  CHECK (kind = 'expense' OR card_id IS NULL)
);

CREATE INDEX idx_tx_household_month ON transactions (household_id, competence_month) WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_category        ON transactions (category_id, competence_month)  WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_invoice         ON transactions (invoice_id);

-- Transferência entre contas NÃO é receita nem despesa.
CREATE TABLE transfers (
  id              INTEGER PRIMARY KEY,
  household_id    INTEGER NOT NULL REFERENCES households(id),
  from_account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  occurred_on     TEXT NOT NULL,
  created_by      INTEGER NOT NULL REFERENCES users(id),
  CHECK (from_account_id <> to_account_id)
);

-- ---------- Orçamento (previsto) e metas ----------
CREATE TABLE budgets (
  id            INTEGER PRIMARY KEY,
  household_id  INTEGER NOT NULL REFERENCES households(id),
  category_id   INTEGER NOT NULL REFERENCES categories(id),
  month         TEXT NOT NULL,                    -- 'YYYY-MM'
  planned_cents INTEGER NOT NULL,
  UNIQUE (category_id, month)
);

CREATE TABLE goals (
  id            INTEGER PRIMARY KEY,
  household_id  INTEGER NOT NULL REFERENCES households(id),
  name          TEXT NOT NULL,
  target_cents  INTEGER NOT NULL,
  saved_cents   INTEGER NOT NULL DEFAULT 0,
  deadline      TEXT,
  completed_at  TEXT
);

-- ---------- Gamificação ----------
-- Fonte da verdade: eventos de XP. Nível e totais são derivados.
CREATE TABLE xp_events (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL,                      -- 'tx_logged','week_review','month_closed','mission_done','goal_done'
  xp          INTEGER NOT NULL,
  ref_id      INTEGER,                            -- id do lançamento/missão/meta de origem
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_xp_user ON xp_events (user_id, created_at);

CREATE TABLE streaks (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id),
  current_days       INTEGER NOT NULL DEFAULT 0,
  longest_days       INTEGER NOT NULL DEFAULT 0,
  last_activity_date TEXT
);

CREATE TABLE achievements (
  code         TEXT PRIMARY KEY,                  -- 'first_tx','streak_7','month_balanced'...
  name         TEXT NOT NULL,
  description  TEXT NOT NULL
);

CREATE TABLE user_achievements (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  code         TEXT NOT NULL REFERENCES achievements(code),
  unlocked_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, code)
);

CREATE TABLE missions (
  id            INTEGER PRIMARY KEY,
  household_id  INTEGER NOT NULL REFERENCES households(id),
  month         TEXT NOT NULL,
  type          TEXT NOT NULL,                    -- 'stay_under_budget','log_every_day','save_target'...
  category_id   INTEGER REFERENCES categories(id),
  target        INTEGER NOT NULL,
  progress      INTEGER NOT NULL DEFAULT 0,
  xp_reward     INTEGER NOT NULL DEFAULT 50,
  completed_at  TEXT
);

-- =====================================================================
-- CONSULTAS-CHAVE
-- =====================================================================

-- 1) Visão anual horizontal (categorias x meses). Troque :year e :household.
--    Para o "previsto", faça o mesmo com a tabela budgets.
--
-- SELECT c.name AS categoria,
--   SUM(CASE WHEN t.competence_month = :year||'-01' THEN t.amount_cents ELSE 0 END) AS jan,
--   SUM(CASE WHEN t.competence_month = :year||'-02' THEN t.amount_cents ELSE 0 END) AS fev,
--   -- ... mar a dez ...
--   SUM(t.amount_cents) AS total
-- FROM transactions t
-- JOIN categories c ON c.id = t.category_id
-- WHERE t.household_id = :household
--   AND t.deleted_at IS NULL
--   AND t.kind = 'expense'
--   AND t.competence_month LIKE :year||'-%'
-- GROUP BY c.id
-- ORDER BY c.sort_order;

-- 2) Saldo atual de uma conta
--
-- SELECT a.initial_balance_cents
--   + COALESCE((SELECT SUM(amount_cents) FROM transactions WHERE account_id = a.id AND kind='income'  AND status='posted' AND deleted_at IS NULL),0)
--   - COALESCE((SELECT SUM(amount_cents) FROM transactions WHERE account_id = a.id AND kind='expense' AND status='posted' AND deleted_at IS NULL),0)
--   - COALESCE((SELECT SUM(paid_amount_cents) FROM invoices WHERE paid_from_account_id = a.id),0)
--   - COALESCE((SELECT SUM(amount_cents) FROM transfers WHERE from_account_id = a.id),0)
--   + COALESCE((SELECT SUM(amount_cents) FROM transfers WHERE to_account_id   = a.id),0)
--   AS balance_cents
-- FROM accounts a WHERE a.id = :account;

-- 3) Nível a partir do XP total (derivado, não armazenado):
--    nivel = floor(sqrt(total_xp / 50)) + 1

-- 4) Lista de Despesas do mês (visão de caixa, fora do cartão) + faturas.
--    Status derivado: paid_on NOT NULL = pago; due_on < date('now') e paid_on NULL = atrasado;
--    senão pendente. A fatura aparece como linha ("Fatura fechada" se closing_date já passou),
--    entra no "a pagar", mas NÃO soma de novo nas despesas por competência.
--
-- SELECT 'tx' AS origem, description, amount_cents, COALESCE(due_on, occurred_on) AS dia, paid_on
-- FROM transactions
-- WHERE household_id = :household AND kind = 'expense' AND card_id IS NULL
--   AND deleted_at IS NULL AND competence_month = :month
-- UNION ALL
-- SELECT 'fatura', cc.name, i.paid_amount_cents, i.due_date, i.paid_on
-- FROM invoices i JOIN credit_cards cc ON cc.id = i.card_id
-- WHERE cc.household_id = :household AND i.reference_month = :month
-- ORDER BY dia;
