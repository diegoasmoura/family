-- De quem é o lançamento. Vazio significa "da casa" e só entra na visão Nós.
ALTER TABLE transactions ADD COLUMN for_user_id INTEGER REFERENCES users(id);
ALTER TABLE recurrences ADD COLUMN for_user_id INTEGER REFERENCES users(id);
