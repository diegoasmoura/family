-- Receita pode entrar no dízimo. A despesa gerada aponta para a receita,
-- ou para o mês inteiro quando o passado foi fechado de uma vez.
ALTER TABLE transactions ADD COLUMN counts_for_tithe INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN tithe_income_id INTEGER REFERENCES transactions(id);
ALTER TABLE transactions ADD COLUMN tithe_month TEXT;

ALTER TABLE recurrences ADD COLUMN counts_for_tithe INTEGER NOT NULL DEFAULT 0;

ALTER TABLE households ADD COLUMN tithe_backfilled INTEGER NOT NULL DEFAULT 0;

UPDATE transactions SET counts_for_tithe = 1 WHERE kind = 'income' AND deleted_at IS NULL;
UPDATE recurrences SET counts_for_tithe = 1 WHERE kind = 'income' AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_tx_tithe_income
  ON transactions (tithe_income_id)
  WHERE deleted_at IS NULL AND tithe_income_id IS NOT NULL;
CREATE UNIQUE INDEX uq_tx_tithe_month
  ON transactions (household_id, tithe_month)
  WHERE deleted_at IS NULL AND tithe_month IS NOT NULL;
