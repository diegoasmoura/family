import type { Db } from '@fin/db';
import { dateInMonth, titheCents } from '@fin/domain';
import { insert, newUuid, nowIso, num, update } from '../core';

const TITHE_NAME = 'Dízimo';

type IncomeRow = {
  id: number;
  kind: string;
  amount_cents: number;
  account_id: number | null;
  for_user_id: number | null;
  competence_month: string;
  counts_for_tithe: number;
  deleted_at: string | null;
};

async function ensureTitheCategory(db: Db, householdId: number): Promise<number> {
  const found = await db.get<{ id: number }>(
    `SELECT id FROM categories WHERE household_id = ? AND kind = 'expense' AND name = ? AND deleted_at IS NULL ORDER BY id LIMIT 1`,
    [householdId, TITHE_NAME],
  );
  if (found) return Number(found.id);
  const now = nowIso();
  const order = await db.get<{ n: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories WHERE household_id = ?', [householdId]);
  return insert(db, 'categories', {
    client_uuid: newUuid(),
    household_id: householdId,
    name: TITHE_NAME,
    kind: 'expense',
    color: '#6B4C9A',
    sort_order: num(order?.n),
    created_at: now,
    updated_at: now,
  });
}

/** Recalcula o dízimo do mês já fechado, sem incluir receita que tem a própria despesa. */
async function recomputeMonthTithe(db: Db, householdId: number, month: string) {
  const monthTithe = await db.get<{ id: number; paid_on: string | null }>(
    'SELECT id, paid_on FROM transactions WHERE household_id = ? AND tithe_month = ? AND deleted_at IS NULL',
    [householdId, month],
  );
  if (!monthTithe || monthTithe.paid_on) return;
  const rows = await db.all<{ account_id: number; for_user_id: number | null; amount_cents: number }>(
    `SELECT account_id, for_user_id, amount_cents
       FROM transactions t
      WHERE t.household_id = ? AND t.kind = 'income' AND t.deleted_at IS NULL
        AND t.counts_for_tithe = 1 AND t.competence_month = ? AND t.account_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM transactions d WHERE d.tithe_income_id = t.id AND d.deleted_at IS NULL
        )`,
    [householdId, month],
  );
  const now = nowIso();
  const total = rows.reduce((sum, row) => sum + num(row.amount_cents), 0);
  const cents = titheCents(total);
  if (cents < 1) {
    await update(db, 'transactions', monthTithe.id, { deleted_at: now, updated_at: now });
    return;
  }
  const accounts = new Map<number, number>();
  const people = new Set<string>();
  for (const row of rows) {
    const accountId = num(row.account_id);
    accounts.set(accountId, (accounts.get(accountId) ?? 0) + num(row.amount_cents));
    people.add(row.for_user_id == null ? '' : String(row.for_user_id));
  }
  const accountId = [...accounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  const person = people.size === 1 ? ([...people][0] === '' ? null : Number([...people][0])) : null;
  await update(db, 'transactions', monthTithe.id, {
    amount_cents: cents,
    account_id: accountId,
    for_user_id: person,
    updated_at: now,
  });
}

/**
 * Cria, atualiza ou apaga o dízimo ligado a esta receita. O que já foi pago fica.
 * `create` só na receita nova: o mês já fechado não ganha uma segunda despesa.
 */
export async function syncTitheForIncome(db: Db, householdId: number, userId: number, incomeId: number, create = false, previousMonth?: string) {
  const income = await db.get<IncomeRow>(
    `SELECT id, kind, amount_cents, account_id, for_user_id, competence_month, counts_for_tithe, deleted_at
       FROM transactions WHERE id = ? AND household_id = ?`,
    [incomeId, householdId],
  );
  if (!income || income.kind !== 'income') return;
  const existing = await db.get<{ id: number; paid_on: string | null }>(
    'SELECT id, paid_on FROM transactions WHERE tithe_income_id = ? AND deleted_at IS NULL',
    [incomeId],
  );
  const cents = titheCents(num(income.amount_cents));
  const open = !income.deleted_at && num(income.counts_for_tithe) === 1 && income.account_id != null && cents >= 1;
  const now = nowIso();
  if (!open) {
    if (existing && !existing.paid_on) await update(db, 'transactions', existing.id, { deleted_at: now, updated_at: now });
  } else if (!existing?.paid_on) {
    const due = dateInMonth(income.competence_month, 30);
    const fields = {
      description: TITHE_NAME,
      amount_cents: cents,
      account_id: num(income.account_id),
      for_user_id: income.for_user_id,
      occurred_on: due,
      due_on: due,
      competence_month: income.competence_month,
      category_id: await ensureTitheCategory(db, householdId),
      updated_at: now,
    };
    if (existing) await update(db, 'transactions', existing.id, fields);
    else if (create) {
      await insert(db, 'transactions', {
        ...fields,
        client_uuid: newUuid(),
        household_id: householdId,
        kind: 'expense',
        status: 'planned',
        paid_on: null,
        counts_for_tithe: 0,
        tithe_income_id: incomeId,
        include_in_reports: 1,
        created_by: userId,
        created_at: now,
      });
    }
  }
  await recomputeMonthTithe(db, householdId, income.competence_month);
  if (previousMonth && previousMonth !== income.competence_month) await recomputeMonthTithe(db, householdId, previousMonth);
}

/** Apaga o dízimo ainda não pago das receitas encontradas por esse filtro. */
export async function deleteOpenTithesMatching(db: Db, whereSql: string, params: unknown[]) {
  const rows = await db.all<{ id: number }>(`SELECT id FROM transactions WHERE ${whereSql}`, params);
  if (!rows.length) return;
  const now = nowIso();
  const ids = rows.map((row) => Number(row.id));
  await db.run(
    `UPDATE transactions SET deleted_at = ?, updated_at = ?
      WHERE deleted_at IS NULL AND paid_on IS NULL AND tithe_income_id IN (${ids.map(() => '?').join(', ')})`,
    [now, now, ...ids],
  );
}

/**
 * Uma vez por casa: cada mês que já tem receita marcada ganha uma despesa
 * com 10% da soma, vencendo no dia 30. Receita que já tem o próprio dízimo fica de fora.
 */
export async function backfillTithes(db: Db) {
  const houses = await db.all<{ id: number }>('SELECT id FROM households WHERE tithe_backfilled = 0');
  for (const house of houses) {
    await db.tx(async (tx) => {
      const author = await tx.get<{ id: number }>(
        `SELECT id FROM users WHERE household_id = ? ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, id LIMIT 1`,
        [house.id],
      );
      const rows = await tx.all<{
        competence_month: string;
        account_id: number;
        for_user_id: number | null;
        amount_cents: number;
      }>(
        `SELECT competence_month, account_id, for_user_id, amount_cents
           FROM transactions t
          WHERE t.household_id = ? AND t.kind = 'income' AND t.deleted_at IS NULL
            AND t.counts_for_tithe = 1 AND t.account_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM transactions d WHERE d.tithe_income_id = t.id AND d.deleted_at IS NULL
            )`,
        [house.id],
      );
      const months = new Map<string, { total: number; accounts: Map<number, number>; people: Set<string> }>();
      for (const row of rows) {
        const bucket = months.get(row.competence_month) ?? { total: 0, accounts: new Map(), people: new Set() };
        const amount = num(row.amount_cents);
        const accountId = num(row.account_id);
        bucket.total += amount;
        bucket.accounts.set(accountId, (bucket.accounts.get(accountId) ?? 0) + amount);
        bucket.people.add(row.for_user_id == null ? '' : String(row.for_user_id));
        months.set(row.competence_month, bucket);
      }
      if (author) {
        for (const [month, bucket] of months) {
          const cents = titheCents(bucket.total);
          if (cents < 1) continue;
          const already = await tx.get(
            'SELECT id FROM transactions WHERE household_id = ? AND tithe_month = ? AND deleted_at IS NULL',
            [house.id, month],
          );
          if (already) continue;
          const accountId = [...bucket.accounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
          const person = bucket.people.size === 1 ? ([...bucket.people][0] === '' ? null : Number([...bucket.people][0])) : null;
          const due = dateInMonth(month, 30);
          const now = nowIso();
          await insert(tx, 'transactions', {
            client_uuid: newUuid(),
            household_id: house.id,
            kind: 'expense',
            description: TITHE_NAME,
            amount_cents: cents,
            occurred_on: due,
            due_on: due,
            competence_month: month,
            category_id: await ensureTitheCategory(tx, house.id),
            account_id: accountId,
            for_user_id: person,
            status: 'planned',
            paid_on: null,
            counts_for_tithe: 0,
            tithe_month: month,
            include_in_reports: 1,
            created_by: author.id,
            created_at: now,
            updated_at: now,
          });
        }
      }
      await tx.run('UPDATE households SET tithe_backfilled = 1 WHERE id = ?', [house.id]);
    });
  }
}
