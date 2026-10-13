-- Chave do celular (digital ou Face ID) para entrar sem digitar a senha.
CREATE TABLE webauthn_credentials (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  credential_id  TEXT NOT NULL UNIQUE,
  public_key     TEXT NOT NULL,
  counter        INTEGER NOT NULL DEFAULT 0,
  device_label   TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE INDEX idx_webauthn_user ON webauthn_credentials (user_id);

-- Desafio de uma cerimônia, apagado assim que ela termina ou vence.
CREATE TABLE webauthn_challenges (
  challenge   TEXT PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  kind        TEXT NOT NULL CHECK (kind IN ('register', 'login')),
  expires_at  TEXT NOT NULL
);
