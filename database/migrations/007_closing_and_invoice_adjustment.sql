-- Correção do saldo no fim do mês. Não é receita nem despesa.
CREATE TABLE account_month_closings (
  id             INTEGER PRIMARY KEY,
  account_id     INTEGER NOT NULL REFERENCES accounts(id),
  month          TEXT NOT NULL,
  closing_cents  INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (account_id, month)
);

-- Diferença da fatura que não é parcela. Pode ser negativa.
ALTER TABLE invoices ADD COLUMN adjustment_cents INTEGER NOT NULL DEFAULT 0;
