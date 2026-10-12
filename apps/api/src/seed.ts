import type { Db } from '@fin/db';
import { addMonths, dateInMonth, monthOf, todayIn } from '@fin/domain';
import { insert, newUuid, nowIso, type Ctx } from './core';
import { hashPassword } from './modules/auth';
import { seedDefaultCategories } from './modules/categories';
import { createPlan } from './modules/installments';
import { ensureRecurrences } from './modules/recurrences';
import { createTransaction } from './modules/transactions';

export const DEMO_PASSWORD = 'demo1234';
export const DEMO_USERS = ['diego@demo.local', 'jhersyka@demo.local'];

/** Dados fictícios só para desenvolvimento e testes. */
export async function seedDemo(db: Db): Promise<{ created: boolean }> {
  if (await db.get('SELECT id FROM users WHERE email = ?', [DEMO_USERS[0]])) return { created: false };
  const timezone = 'America/Sao_Paulo';
  const today = todayIn(timezone);
  const month = monthOf(today);
  const now = nowIso();
  const hash = await hashPassword(DEMO_PASSWORD);

  const householdId = await insert(db, 'households', { name: 'Diego e Jhersyka (demo)', timezone, created_at: now });
  const diego = await insert(db, 'users', { household_id: householdId, name: 'Diego', email: DEMO_USERS[0], password_hash: hash, role: 'admin', created_at: now });
  await insert(db, 'users', { household_id: householdId, name: 'Jhersyka', email: DEMO_USERS[1], password_hash: hash, role: 'member', created_at: now });
  await seedDefaultCategories(db, householdId);

  const ctx: Ctx = { db, userId: diego, householdId, role: 'admin', timezone, today };
  const cat = async (name: string) => (await db.get<{ id: number }>('SELECT id FROM categories WHERE household_id = ? AND name = ?', [householdId, name]))!.id;

  const start = addMonths(month, -1);
  const bradesco = await insert(db, 'accounts', {
    client_uuid: newUuid(),
    household_id: householdId,
    name: 'Bradesco',
    type: 'checking',
    initial_balance_cents: 450000,
    initial_balance_on: `${start}-01`,
    created_at: now,
    updated_at: now,
  });
  await insert(db, 'accounts', {
    client_uuid: newUuid(),
    household_id: householdId,
    name: 'Dinheiro',
    type: 'cash',
    initial_balance_cents: 30000,
    initial_balance_on: `${start}-01`,
    created_at: now,
    updated_at: now,
  });
  const ultra = await insert(db, 'credit_cards', {
    client_uuid: newUuid(),
    household_id: householdId,
    name: 'Ultra',
    brand: 'Mastercard',
    closing_day: 7,
    due_day: 6,
    limit_cents: 1410000,
    default_pay_account_id: bradesco,
    created_at: now,
    updated_at: now,
  });

  const salario = await cat('Salário');
  for (const [description, day, amount] of [
    ['Salário dia 15', 15, 499436],
    ['Salário dia 30', 30, 333536],
  ] as const) {
    await insert(db, 'recurrences', {
      client_uuid: newUuid(),
      household_id: householdId,
      kind: 'income',
      description,
      amount_cents: amount,
      category_id: salario,
      account_id: bradesco,
      day_of_month: day,
      start_month: start,
      created_by: diego,
      created_at: now,
      updated_at: now,
    });
  }
  await insert(db, 'recurrences', {
    client_uuid: newUuid(),
    household_id: householdId,
    kind: 'expense',
    description: 'Internet',
    amount_cents: 12000,
    category_id: await cat('Internet'),
    account_id: bradesco,
    day_of_month: 10,
    start_month: start,
    created_by: diego,
    created_at: now,
    updated_at: now,
  });
  await insert(db, 'recurrences', {
    client_uuid: newUuid(),
    household_id: householdId,
    kind: 'expense',
    description: 'Netflix',
    amount_cents: 5590,
    category_id: await cat('Assinaturas'),
    card_id: ultra,
    day_of_month: 12,
    start_month: start,
    created_by: diego,
    created_at: now,
    updated_at: now,
  });
  await ensureRecurrences(ctx, month);
  // Ocorrências já vencidas do mês passado ficam efetivadas.
  await db.run(
    "UPDATE transactions SET status = 'posted', paid_on = occurred_on WHERE household_id = ? AND recurrence_id IS NOT NULL AND account_id IS NOT NULL AND occurred_on < ?",
    [householdId, `${month}-01`],
  );
  await db.run(
    "UPDATE transactions SET status = 'posted' WHERE household_id = ? AND recurrence_id IS NOT NULL AND card_id IS NOT NULL AND occurred_on < ?",
    [householdId, today],
  );

  await createPlan(ctx, {
    description: 'Carro',
    total_cents: 196400 * 60,
    installments: 60,
    account_id: bradesco,
    category_id: await cat('Transporte'),
    purchased_on: dateInMonth(month, 10),
  });
  await createPlan(ctx, {
    description: 'IPVA Song Pro',
    total_cents: 120000 * 3,
    installments: 3,
    account_id: bradesco,
    category_id: await cat('IPVA'),
    purchased_on: dateInMonth(start, 20),
    first_paid: true,
  });
  await createPlan(ctx, {
    description: 'Notebook',
    total_cents: 270000,
    installments: 6,
    card_id: ultra,
    category_id: await cat('Educação'),
    purchased_on: dateInMonth(addMonths(month, -2), 15),
  });

  const purchases: [string, string, number, string][] = [
    ['Estacionamento', 'Estacionamento', 13000, dateInMonth(month, 2)],
    ['Mercado', 'Mercado', 32000, dateInMonth(start, 12)],
    ['Restaurante', 'Restaurante', 26000, dateInMonth(start, 9)],
    ['Posto', 'Combustível', 18000, dateInMonth(start, 27)],
    ['Roupas', 'Lazer', 70000, dateInMonth(month, 3)],
  ];
  for (const [description, category, amount, date] of purchases) {
    await createTransaction(ctx, { kind: 'expense', description, amount_cents: amount, occurred_on: date, card_id: ultra, category_id: await cat(category) });
  }
  await createTransaction(ctx, {
    kind: 'expense',
    description: 'Crédito TIM',
    amount_cents: 3000,
    occurred_on: dateInMonth(month, 5),
    account_id: bradesco,
    category_id: await cat('Telefone'),
  });
  await createTransaction(ctx, {
    kind: 'expense',
    description: 'Feira',
    amount_cents: 8500,
    occurred_on: dateInMonth(month, 1),
    account_id: bradesco,
    category_id: await cat('Mercado'),
  });

  for (const [name, amount] of [
    ['Moradia', 250000],
    ['Alimentação', 120000],
    ['Transporte', 250000],
  ] as const) {
    await insert(db, 'budgets', {
      client_uuid: newUuid(),
      household_id: householdId,
      category_id: await cat(name),
      month,
      planned_cents: amount,
      created_at: now,
      updated_at: now,
    });
  }
  await insert(db, 'goals', {
    client_uuid: newUuid(),
    household_id: householdId,
    name: 'Viagem',
    target_cents: 1000000,
    saved_cents: 400000,
    deadline: dateInMonth(addMonths(month, 8), 1),
    created_at: now,
    updated_at: now,
  });
  return { created: true };
}
