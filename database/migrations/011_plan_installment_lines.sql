-- Uma prestação dividida entre as duas pessoas vira uma linha por pessoa,
-- com o mesmo número de parcela. Continua valendo uma linha "da casa" por parcela.
DROP INDEX IF EXISTS uq_tx_plan_installment;
CREATE UNIQUE INDEX uq_tx_plan_installment_house
  ON transactions (plan_id, installment_no)
  WHERE deleted_at IS NULL AND plan_id IS NOT NULL AND for_user_id IS NULL;
CREATE UNIQUE INDEX uq_tx_plan_installment_person
  ON transactions (plan_id, installment_no, for_user_id)
  WHERE deleted_at IS NULL AND plan_id IS NOT NULL AND for_user_id IS NOT NULL;
