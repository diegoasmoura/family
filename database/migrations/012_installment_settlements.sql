-- Quitação conjunta de uma prestação dividida.
-- A responsabilidade continua em for_user_id/split_bp; estes campos registram
-- quem efetivamente pagou e permitem restaurar a ocorrência ao desfazer.
ALTER TABLE transactions ADD COLUMN paid_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE transactions ADD COLUMN settlement_expected_cents INTEGER;
ALTER TABLE transactions ADD COLUMN settlement_previous_account_id INTEGER REFERENCES accounts(id);
ALTER TABLE transactions ADD COLUMN settlement_previous_overridden INTEGER;
ALTER TABLE transactions ADD COLUMN settlement_uuid TEXT;

CREATE INDEX idx_tx_settlement_uuid
  ON transactions (settlement_uuid)
  WHERE settlement_uuid IS NOT NULL;
