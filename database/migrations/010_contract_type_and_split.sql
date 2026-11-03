-- Tipo do contrato, para a ilustração do card: car, house, moto, study, loan ou other.
ALTER TABLE installment_plans ADD COLUMN contract_type TEXT;

-- "Nosso" (for_user_id vazio) é dividido entre as duas pessoas. No Eu, cada um vê a sua parte.
-- split_user_id fica com split_bp (5000 = 50%), arredondado para cima; a outra pessoa, com o resto.
-- Vazio: meio a meio, e o centavo ímpar vai para quem lançou (created_by).
ALTER TABLE transactions ADD COLUMN split_user_id INTEGER REFERENCES users(id);
ALTER TABLE transactions ADD COLUMN split_bp INTEGER;
-- A fixa guarda a mesma divisão e passa para cada mês que gera.
ALTER TABLE recurrences ADD COLUMN split_user_id INTEGER REFERENCES users(id);
ALTER TABLE recurrences ADD COLUMN split_bp INTEGER;
