-- O dízimo do mês é um por pessoa, para aparecer no Eu de quem teve a receita.
DROP INDEX IF EXISTS uq_tx_tithe_month;

CREATE UNIQUE INDEX uq_tx_tithe_month
  ON transactions (household_id, tithe_month, COALESCE(for_user_id, 0))
  WHERE deleted_at IS NULL AND tithe_month IS NOT NULL;

-- Casa em que o fechamento não gerou despesa: a receita antiga volta a entrar.
UPDATE transactions SET counts_for_tithe = 1
 WHERE kind = 'income' AND deleted_at IS NULL AND counts_for_tithe = 0
   AND NOT EXISTS (
     SELECT 1 FROM transactions d
      WHERE d.household_id = transactions.household_id
        AND d.deleted_at IS NULL
        AND (d.tithe_month IS NOT NULL OR d.tithe_income_id IS NOT NULL)
   );

UPDATE recurrences SET counts_for_tithe = 1
 WHERE kind = 'income' AND deleted_at IS NULL AND counts_for_tithe = 0
   AND NOT EXISTS (
     SELECT 1 FROM transactions d
      WHERE d.household_id = recurrences.household_id
        AND d.deleted_at IS NULL
        AND (d.tithe_month IS NOT NULL OR d.tithe_income_id IS NOT NULL)
   );
