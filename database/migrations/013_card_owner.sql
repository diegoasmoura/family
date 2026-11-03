-- Titular do cartão. Vazio é "Da casa" e só entra no Nós.
ALTER TABLE credit_cards ADD COLUMN for_user_id INTEGER REFERENCES users(id);

-- Os cartões que já existem ficam do administrador da casa.
UPDATE credit_cards
   SET for_user_id = (
     SELECT u.id FROM users u
      WHERE u.household_id = credit_cards.household_id AND u.role = 'admin'
      ORDER BY u.id
      LIMIT 1
   )
 WHERE for_user_id IS NULL AND deleted_at IS NULL;
