-- Contrato (financiamento ou empréstimo): um parcelamento em conta marcado, não um sistema à parte.
-- As prestações continuam sendo os lançamentos do parcelamento; estes campos só descrevem o contrato.
ALTER TABLE installment_plans ADD COLUMN is_contract INTEGER NOT NULL DEFAULT 0;
-- Banco, financeira ou órgão (ex.: Bradesco, Fies).
ALTER TABLE installment_plans ADD COLUMN lender TEXT;
-- Quanto foi contratado (o que entrou ou o valor do bem financiado), em centavos.
ALTER TABLE installment_plans ADD COLUMN contracted_cents INTEGER;
-- Juros ao mês em centésimos de ponto percentual (1,49% = 149).
ALTER TABLE installment_plans ADD COLUMN monthly_rate_bp INTEGER;
