import type { Db } from '@fin/db';
import { dateInMonth, relatedColor, titheCents } from '@fin/domain';
import { insert, newUuid, nowIso, num, update } from '../core';

const TITHE_NAME = 'Dízimo';
const TITHE_GROUP = 'Reino';
const TITHE_SUB = 'Geral';
const GROUP_COLOR = '#6B4C9A';

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

function personKey(id: number | null | undefined) {
  return id == null ? '' : String(Number(id));
}

async function nextSort(db: Db, householdId: number) {
  const order = await db.get<{ n: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories WHERE household_id = ?', [householdId]);
  return num(order?.n);
}

/** A mesma categoria da oferta: grupo Reino, subgrupo Geral. */
async function ensureTitheCategory(db: Db, householdId: number): Promise<number> {
  const found = await db.get<{ id: number }>(
    `SELECT c.id
       FROM categories c
       JOIN categories p ON p.id = c.parent_id
      WHERE c.household_id = ? AND c.kind = 'expense' AND c.deleted_at IS NULL
        AND p.deleted_at IS NULL AND p.name = ? AND c.name = ?
      ORDER BY c.id LIMIT 1`,
    [householdId, TITHE_GROUP, TITHE_SUB],
  );
  if (found) return Number(found.id);
  const now = nowIso();
  let parent = await db.get<{ id: number; color: string | null }>(
    `SELECT id, color FROM categories
      WHERE household_id = ? AND kind = 'expense' AND parent_id IS NULL AND name = ? AND deleted_at IS NULL
      ORDER BY id LIMIT 1`,
    [householdId, TITHE_GROUP],
  );
  if (!parent) {
    const id = await insert(db, 'categories', {
      client_uuid: newUuid(),
      household_id: householdId,
      name: TITHE_GROUP,
      kind: 'expense',
      color: GROUP_COLOR,
      sort_order: await nextSort(db, householdId),
      created_at: now,
      updated_at: now,
    });
    parent = { id, color: GROUP_COLOR };
  }
  return insert(db, 'categories', {
    client_uuid: newUuid(),
    household_id: householdId,
    name: TITHE_SUB,
    kind: 'expense',
    parent_id: Number(parent.id),
    color: relatedColor(parent.color || GROUP_COLOR, TITHE_SUB),
    sort_order: await nextSort(db, householdId),
    created_at: now,
    updated_at: now,
  });
}

type Bucket = { person: number | null; total: number; accounts: Map<number, number> };

/** Soma o mês por pessoa. Receita que já tem a própria despesa fica de fora. */
async function monthBuckets(db: Db, householdId: number, month: string): Promise<Bucket[]> {
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
  const groups = new Map<string, Bucket>();
  for (const row of rows) {
    const key = personKey(row.for_user_id);
    const bucket = groups.get(key) ?? { person: key === '' ? null : Number(key), total: 0, accounts: new Map() };
    const amount = num(row.amount_cents);
    const accountId = num(row.account_id);
    bucket.total += amount;
    bucket.accounts.set(accountId, (bucket.accounts.get(accountId) ?? 0) + amount);
    groups.set(key, bucket);
  }
  return [...groups.values()];
}

function winningAccount(accounts: Map<number, number>) {
  return [...accounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/**
 * Uma despesa por pessoa no mês. O que é da casa continua da casa.
 * Despesa já paga não muda. A que não tem mais receita em aberto sai.
 */
async function reconcileMonthTithe(db: Db, householdId: number, userId: number, month: string) {
  const buckets = await monthBuckets(db, householdId, month);
  const existing = await db.all<{ id: number; paid_on: string | null; for_user_id: number | null }>(
    'SELECT id, paid_on, for_user_id FROM transactions WHERE household_id = ? AND tithe_month = ? AND deleted_at IS NULL',
    [householdId, month],
  );
  const now = nowIso();
  const used = new Set<number>();
  let categoryId: number | null = null;
  const category = async () => (categoryId ??= await ensureTitheCategory(db, householdId));
  for (const bucket of buckets) {
    const cents = titheCents(bucket.total);
    const match = existing.find((row) => !used.has(row.id) && personKey(row.for_user_id) === personKey(bucket.person));
    if (cents < 1) {
      if (match && !match.paid_on) {
        await update(db, 'transactions', match.id, { deleted_at: now, updated_at: now });
        used.add(match.id);
      }
      continue;
    }
    const due = dateInMonth(month, 30);
    const fields = {
      description: TITHE_NAME,
      amount_cents: cents,
      account_id: winningAccount(bucket.accounts),
      for_user_id: bucket.person,
      occurred_on: due,
      due_on: due,
      competence_month: month,
      category_id: await category(),
      updated_at: now,
    };
    if (match) {
      used.add(match.id);
      if (!match.paid_on) await update(db, 'transactions', match.id, fields);
    } else {
      await insert(db, 'transactions', {
        ...fields,
        client_uuid: newUuid(),
        household_id: householdId,
        kind: 'expense',
        status: 'planned',
        paid_on: null,
        counts_for_tithe: 0,
        tithe_month: month,
        include_in_reports: 1,
        created_by: userId,
        created_at: now,
      });
    }
  }
  for (const row of existing) {
    if (!used.has(row.id) && !row.paid_on) await update(db, 'transactions', row.id, { deleted_at: now, updated_at: now });
  }
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
  await reconcileMonthTithe(db, householdId, userId, income.competence_month);
  if (previousMonth && previousMonth !== income.competence_month) await reconcileMonthTithe(db, householdId, userId, previousMonth);
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
  const houses = await db.all<{ id: number }>('SELECT id FROM households WHERE tithe_backfilled < 2');
  for (const house of houses) {
    await db.tx(async (tx) => {
      const author = await tx.get<{ id: number }>(
        `SELECT id FROM users WHERE household_id = ? ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, id LIMIT 1`,
        [house.id],
      );
      if (author) {
        const months = await tx.all<{ competence_month: string }>(
          `SELECT DISTINCT competence_month FROM transactions
            WHERE household_id = ? AND kind = 'income' AND deleted_at IS NULL AND counts_for_tithe = 1`,
          [house.id],
        );
        for (const row of months) await reconcileMonthTithe(tx, house.id, author.id, row.competence_month);
      }
      await tx.run('UPDATE households SET tithe_backfilled = 2 WHERE id = ?', [house.id]);
    });
  }
}
