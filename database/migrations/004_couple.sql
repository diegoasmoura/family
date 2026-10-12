-- Vínculo entre duas casas. Só o calendário lê a outra casa.
CREATE TABLE couple_links (
  id                INTEGER PRIMARY KEY,
  household_low_id  INTEGER NOT NULL REFERENCES households(id),
  household_high_id INTEGER NOT NULL REFERENCES households(id),
  status            TEXT NOT NULL CHECK (status IN ('pending', 'active', 'revoked')),
  created_at        TEXT NOT NULL,
  accepted_at       TEXT,
  revoked_at        TEXT,
  CHECK (household_low_id < household_high_id)
);

CREATE UNIQUE INDEX uq_couple_active
  ON couple_links (household_low_id, household_high_id)
  WHERE status = 'active';

CREATE TABLE couple_invites (
  id                   INTEGER PRIMARY KEY,
  inviter_household_id INTEGER NOT NULL REFERENCES households(id),
  inviter_user_id      INTEGER NOT NULL REFERENCES users(id),
  code_hash            TEXT NOT NULL UNIQUE,
  invitee_email        TEXT,
  expires_at           TEXT NOT NULL,
  accepted_by_user_id  INTEGER REFERENCES users(id),
  couple_link_id       INTEGER REFERENCES couple_links(id),
  created_at           TEXT NOT NULL
);
