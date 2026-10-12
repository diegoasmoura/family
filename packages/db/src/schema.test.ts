import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, migrate, type Db } from './index';
import { adaptSql } from './migrate';

const now = '2026-10-08T12:00:00.000Z';
let db: Db;
let seq = 0;
const uuid = () => `uuid-${++seq}`;

async function base() {
  await db.run('INSERT INTO households (id, name, created_at) VALUES (1, ?, ?)', ['Casa', now]);
  await db.run("INSERT INTO users (id, household_id, name, email, password_hash, role, created_at) VALUES (1, 1, 'Diego', 'd@x', 'h', 'admin', ?)", [now]);
  await db.run(
    "INSERT INTO accounts (id, client_uuid, household_id, name, type, initial_balance_on, created_at, updated_at) VALUES (1, ?, 1, 'Bradesco', 'checking', '2026-10-01', ?, ?)",
    [uuid(), now, now],
  );
  await db.run(
    "INSERT INTO credit_cards (id, client_uuid, household_id, name, closing_day, due_day, created_at, updated_at) VALUES (1, ?, 1, 'Ultra', 7, 6, ?, ?)",
    [uuid(), now, now],
  );
  await db.run("INSERT INTO invoices (id, card_id, reference_month, closing_date, due_date, created_at, updated_at) VALUES (1, 1, '2026-11', '2026-10-07', '2026-11-06', ?, ?)", [now, now]);
}

function tx(fields: Record<string, unknown>) {
  const row = {
    client_uuid: uuid(),
    household_id: 1,
    kind: 'expense',
    amount_cents: 100,
    occurred_on: '2026-10-08',
    competence_month: '2026-10',
    status: 'planned',
    created_by: 1,
    created_at: now,
    updated_at: now,
    ...fields,
  };
  const cols = Object.keys(row);
  return db.run(`INSERT INTO transactions (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, Object.values(row));
}

const CHECK = /CHECK|check constraint/;
const UNIQUE = /UNIQUE|unique constraint/;

const targets: [string, string][] = [['sqlite', 'sqlite::memory:']];
if (process.env.TEST_PG_URL) targets.push(['postgres', process.env.TEST_PG_URL]);

describe.each(targets)('schema v0.3 (%s)', (dialect, url) => {
  beforeEach(async () => {
    db = createDb(url);
    if (dialect === 'postgres') await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(db);
    await base();
  });
  afterEach(async () => db.close());

  it('é idempotente ao migrar de novo', async () => {
    expect(await migrate(db)).toEqual([]);
  });

  it('exige conta OU cartão, nunca os dois', async () => {
    await expect(tx({ account_id: 1, card_id: 1, invoice_id: 1, status: 'posted' })).rejects.toThrow(CHECK);
    await expect(tx({})).rejects.toThrow(CHECK);
    await tx({ account_id: 1 });
  });

  it('impede receita no cartão', async () => {
    await expect(tx({ kind: 'income', card_id: 1, invoice_id: 1, status: 'posted' })).rejects.toThrow(CHECK);
  });

  it('compra no cartão precisa de fatura', async () => {
    await expect(tx({ card_id: 1, status: 'posted' })).rejects.toThrow(CHECK);
    await tx({ card_id: 1, invoice_id: 1, status: 'posted' });
  });

  it('em conta, efetivado exige data de pagamento', async () => {
    await expect(tx({ account_id: 1, status: 'posted' })).rejects.toThrow(CHECK);
    await expect(tx({ account_id: 1, status: 'planned', paid_on: '2026-10-08' })).rejects.toThrow(CHECK);
    await tx({ account_id: 1, status: 'posted', paid_on: '2026-10-08' });
  });

  it('impede parcela repetida no mesmo plano, exceto se excluída', async () => {
    await db.run(
      "INSERT INTO installment_plans (id, client_uuid, household_id, description, total_cents, installments, account_id, purchased_on, created_by, created_at, updated_at) VALUES (1, ?, 1, 'Carro', 200, 2, 1, '2026-10-01', 1, ?, ?)",
      [uuid(), now, now],
    );
    await tx({ account_id: 1, plan_id: 1, installment_no: 1 });
    await expect(tx({ account_id: 1, plan_id: 1, installment_no: 1 })).rejects.toThrow(UNIQUE);
    await tx({ account_id: 1, plan_id: 1, installment_no: 1, deleted_at: now });
  });

  it('parcelamento em conta OU cartão', async () => {
    await expect(
      db.run(
        "INSERT INTO installment_plans (client_uuid, household_id, description, total_cents, installments, account_id, card_id, purchased_on, created_by, created_at, updated_at) VALUES (?, 1, 'X', 200, 2, 1, 1, '2026-10-01', 1, ?, ?)",
        [uuid(), now, now],
      ),
    ).rejects.toThrow(CHECK);
  });

  it('uma recorrência gera no máximo um lançamento por competência', async () => {
    await db.run(
      "INSERT INTO recurrences (id, client_uuid, household_id, kind, description, amount_cents, account_id, day_of_month, start_month, created_by, created_at, updated_at) VALUES (1, ?, 1, 'expense', 'Internet', 12000, 1, 10, '2026-10', 1, ?, ?)",
      [uuid(), now, now],
    );
    await tx({ account_id: 1, recurrence_id: 1 });
    await expect(tx({ account_id: 1, recurrence_id: 1 })).rejects.toThrow(UNIQUE);
  });

  it('papel de usuário restrito a admin/member', async () => {
    await expect(
      db.run("INSERT INTO users (household_id, name, email, password_hash, role, created_at) VALUES (1, 'X', 'x@x', 'h', 'owner', ?)", [now]),
    ).rejects.toThrow(CHECK);
  });

  it('adapta chaves primárias para identity no PostgreSQL', () => {
    const sql = 'CREATE TABLE a (\n  id          INTEGER PRIMARY KEY,\n  user_id INTEGER NOT NULL PRIMARY KEY\n)';
    const out = adaptSql(sql, 'pg');
    expect(out).toContain('id          INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY');
    expect(out).toContain('user_id INTEGER NOT NULL PRIMARY KEY');
  });
});
