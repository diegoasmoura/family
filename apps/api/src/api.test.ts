import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDb, migrate, type Db } from '@fin/db';
import { createApp } from './app';
import { loadConfig } from './config';

const TODAY = '2026-10-08';
const targets: [string, string][] = [['sqlite', 'sqlite::memory:']];
if (process.env.TEST_PG_URL) targets.push(['postgres', process.env.TEST_PG_URL]);

describe.each(targets)('API (%s)', (dialect, url) => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let agent: ReturnType<typeof request.agent>;
  let ids: { bradesco: number; nubank: number; ultra: number; cat: Record<string, number> };

  async function register(email: string, household = 'Casa') {
    const a = request.agent(app);
    const res = await a.post('/api/auth/register').send({ household_name: household, name: 'Diego', email, password: 'senha-segura' });
    expect(res.status).toBe(201);
    return a;
  }

  async function ok(res: request.Response, status = 200) {
    if (res.status !== status) throw new Error(`${res.status}: ${JSON.stringify(res.body)}`);
    return res.body;
  }

  beforeEach(async () => {
    db = createDb(url);
    if (dialect === 'postgres') await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(db);
    app = createApp(db, { ...loadConfig({}), fixedToday: TODAY });
    agent = await register('diego@x.com');
    const cats = await ok(await agent.get('/api/categories'));
    const cat = Object.fromEntries(cats.map((c: any) => [c.name, c.id]));
    const bradesco = (await ok(await agent.post('/api/accounts').send({ name: 'Bradesco', type: 'checking', initial_balance_cents: 450000, initial_balance_on: '2026-10-01' }), 201)).id;
    const nubank = (await ok(await agent.post('/api/accounts').send({ name: 'Nubank', type: 'checking', initial_balance_cents: 0, initial_balance_on: '2026-10-01' }), 201)).id;
    const ultra = (
      await ok(
        await agent.post('/api/cards').send({ name: 'Ultra', brand: 'Mastercard', closing_day: 7, due_day: 6, limit_cents: 1410000, default_pay_account_id: bradesco }),
        201,
      )
    ).id;
    ids = { bradesco, nubank, ultra, cat };
  });

  afterEach(async () => db.close());

  const balanceOf = async (accountId: number, month?: string) => {
    const res = await ok(await agent.get(`/api/accounts${month ? `?month=${month}` : ''}`));
    return res.accounts.find((a: any) => a.id === accountId);
  };

  describe('fundação', () => {
    it('responde healthcheck', async () => {
      expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok' });
    });

    it('exige login', async () => {
      expect((await request(app).get('/api/accounts')).status).toBe(401);
    });

    it('não guarda senha em texto puro', async () => {
      const row = await db.get('SELECT password_hash FROM users WHERE email = ?', ['diego@x.com']);
      expect(row.password_hash).not.toContain('senha-segura');
      expect(row.password_hash).toMatch(/^\$2/);
    });

    it('faz login e logout', async () => {
      const a = request.agent(app);
      expect((await a.post('/api/auth/login').send({ email: 'diego@x.com', password: 'errada' })).status).toBe(401);
      expect((await a.post('/api/auth/login').send({ email: 'diego@x.com', password: 'senha-segura' })).status).toBe(200);
      expect((await a.get('/api/auth/me')).body.role).toBe('admin');
      await a.post('/api/auth/logout');
      expect((await a.get('/api/auth/me')).status).toBe(401);
    });

    it('isola households', async () => {
      const other = await register('outra@x.com', 'Outra casa');
      expect((await other.get(`/api/accounts/${ids.bradesco}/balance`)).status).toBe(404);
      expect((await other.post('/api/transactions').send({ kind: 'expense', amount_cents: 100, account_id: ids.bradesco })).status).toBe(404);
      expect((await other.get('/api/accounts')).body.accounts).toEqual([]);
    });

    it('membro não arquiva conta nem cria usuário', async () => {
      await ok(await agent.post('/api/users').send({ name: 'Jhersyka', email: 'j@x.com', password: 'senha-segura' }), 201);
      const member = request.agent(app);
      await ok(await member.post('/api/auth/login').send({ email: 'j@x.com', password: 'senha-segura' }));
      expect((await member.delete(`/api/accounts/${ids.bradesco}`)).status).toBe(403);
      expect((await member.post('/api/users').send({ name: 'X', email: 'x@x.com', password: 'senha-segura' })).status).toBe(403);
      // Membro lança normalmente no household compartilhado.
      await ok(await member.post('/api/transactions').send({ kind: 'expense', amount_cents: 100, account_id: ids.bradesco }), 201);
    });
  });

  describe('contas e caixa', () => {
    it('saldo atual ignora previstos; saldo previsto inclui', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'income', amount_cents: 333536, occurred_on: '2026-10-05', account_id: ids.bradesco }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 13000, occurred_on: '2026-10-06', account_id: ids.bradesco }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 196400, occurred_on: '2026-10-20', account_id: ids.bradesco }), 201);
      const b = await balanceOf(ids.bradesco);
      expect(b.current_balance_cents).toBe(450000 + 333536 - 13000);
      expect(b.forecast_balance_cents).toBe(450000 + 333536 - 13000 - 196400);
    });

    it('transferência move saldo sem virar receita nem despesa', async () => {
      await ok(await agent.post('/api/transfers').send({ from_account_id: ids.bradesco, to_account_id: ids.nubank, amount_cents: 100000, occurred_on: '2026-10-07' }), 201);
      expect((await balanceOf(ids.bradesco)).current_balance_cents).toBe(350000);
      expect((await balanceOf(ids.nubank)).current_balance_cents).toBe(100000);
      const dash = await ok(await agent.get('/api/dashboard'));
      expect(dash.income.total_cents).toBe(0);
      expect(dash.expense.total_cents).toBe(0);
      expect(dash.balance.current_cents).toBe(450000);
      expect((await agent.post('/api/transfers').send({ from_account_id: ids.bradesco, to_account_id: ids.bradesco, amount_cents: 1 })).status).toBe(400);
    });

    it('arquiva conta com histórico em vez de excluir', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 100, account_id: ids.nubank }), 201);
      expect((await ok(await agent.delete(`/api/accounts/${ids.nubank}`))).archived).toBe(true);
    });
  });

  describe('lançamentos', () => {
    it('valida conta XOR cartão e receita fora do cartão', async () => {
      expect((await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 100 })).status).toBe(400);
      expect((await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 100, account_id: ids.bradesco, card_id: ids.ultra })).status).toBe(400);
      expect((await agent.post('/api/transactions').send({ kind: 'income', amount_cents: 100, card_id: ids.ultra })).status).toBe(400);
      expect((await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 10.5, account_id: ids.bradesco })).status).toBe(400);
      expect((await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 100, account_id: ids.bradesco, category_id: ids.cat['Salário'] })).status).toBe(400);
    });

    it('a fatura separa parcela e fixa e soma o restante', async () => {
      const loose = await ok(
        await agent.post('/api/transactions').send({ kind: 'expense', description: 'Gasolina', amount_cents: 4000, occurred_on: '2026-10-01', card_id: ids.ultra }),
        201,
      );
      const month = loose.transaction.competence_month;
      await ok(
        await agent.post('/api/installments').send({ description: 'Geladeira', total_cents: 360000, installments: 9, card_id: ids.ultra, purchased_on: '2026-10-01' }),
        201,
      );
      await ok(
        await agent.post('/api/recurrences').send({ kind: 'expense', description: 'Seguro', amount_cents: 30000, card_id: ids.ultra, day_of_month: 1, start_month: month }),
        201,
      );
      const view = await ok(await agent.get(`/api/transactions?month=${month}&kind=expense`));
      const invoice = view.invoices.find((i: any) => i.card_id === ids.ultra);
      expect(invoice.lines.map((l: any) => [l.kind, l.description, l.label ?? l.count, l.amount_cents])).toEqual([
        ['installment', 'Geladeira', '1/9', 40000],
        ['fixed', 'Seguro', 'Fixa', 30000],
        ['other', 'Outras compras', 1, 4000],
      ]);
      expect(invoice.lines.reduce((a: number, l: any) => a + l.amount_cents, 0)).toBe(invoice.total_cents);
    });

    it('é idempotente por client_uuid', async () => {
      const body = { client_uuid: 'offline-123456', kind: 'expense', amount_cents: 500, account_id: ids.bradesco };
      const a = await ok(await agent.post('/api/transactions').send(body), 201);
      const b = await ok(await agent.post('/api/transactions').send(body), 200);
      expect(b.transaction.id).toBe(a.transaction.id);
    });

    it('deriva status e monta o resumo do mês', async () => {
      const post = (b: object) => agent.post('/api/transactions').send({ kind: 'expense', account_id: ids.bradesco, ...b });
      await ok(await post({ amount_cents: 1000, occurred_on: '2026-10-01' }), 201);
      await ok(await post({ amount_cents: 2000, occurred_on: '2026-10-02', paid: false }), 201);
      await ok(await post({ amount_cents: 3000, occurred_on: '2026-10-12' }), 201);
      await ok(await post({ amount_cents: 4000, occurred_on: '2026-10-28' }), 201);
      await ok(await post({ amount_cents: 500, occurred_on: '2026-10-03', include_in_reports: false }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 7000, occurred_on: '2026-09-05', card_id: ids.ultra }), 201);

      const view = await ok(await agent.get('/api/transactions?month=2026-10&kind=expense'));
      const statuses = view.items.map((t: any) => [t.amount_cents, t.status_label]);
      expect(statuses).toEqual([
        [1000, 'Pago'],
        [2000, 'Atrasado'],
        [500, 'Pago'],
        [3000, 'Próximo'],
        [4000, 'Previsto'],
      ]);
      expect(view.invoices).toHaveLength(1);
      expect(view.invoices[0]).toMatchObject({ card_name: 'Ultra', total_cents: 7000, reference_month: '2026-10' });
      expect(view.invoices[0].lines).toEqual([{ kind: 'other', description: 'Outras compras', count: 1, amount_cents: 7000 }]);
      expect(view.summary).toMatchObject({
        records: 6,
        total_cents: 17000,
        total_without_cards_cents: 10000,
        not_summed_cents: 500,
        total_with_not_summed_cents: 17500,
        situation: { paid: 1000, overdue: 2000, near: 3000, planned: 4000, unpaid: 9000, cards: 7000 },
        recurrence: { fixed: 0, installment: 0, variable: 17000 },
      });
    });

    it('efetiva, desfaz, exclui e restaura', async () => {
      const { transaction: t } = await ok(
        await agent.post('/api/transactions').send({ kind: 'income', amount_cents: 333536, occurred_on: '2026-10-30', account_id: ids.bradesco }),
        201,
      );
      expect(t.status).toBe('planned');
      expect((await balanceOf(ids.bradesco)).current_balance_cents).toBe(450000);
      const paid = await ok(await agent.post(`/api/transactions/${t.id}/pay`).send({}));
      expect(paid).toMatchObject({ status: 'posted', paid_on: TODAY, status_label: 'Recebido' });
      expect((await balanceOf(ids.bradesco)).current_balance_cents).toBe(450000 + 333536);
      await ok(await agent.post(`/api/transactions/${t.id}/unpay`).send({}));
      await ok(await agent.delete(`/api/transactions/${t.id}`));
      expect((await ok(await agent.get('/api/transactions?month=2026-10&kind=income'))).items).toHaveLength(0);
      await ok(await agent.post(`/api/transactions/${t.id}/restore`).send({}));
      expect((await ok(await agent.get('/api/transactions?month=2026-10&kind=income'))).items).toHaveLength(1);
    });
  });

  describe('recorrências', () => {
    it('gera uma ocorrência por competência, de forma idempotente', async () => {
      const { recurrence } = await ok(
        await agent.post('/api/recurrences').send({ kind: 'expense', description: 'Internet', amount_cents: 12000, account_id: ids.bradesco, day_of_month: 10, start_month: '2026-10' }),
        201,
      );
      await agent.get('/api/transactions?month=2026-12&kind=expense');
      await agent.get('/api/transactions?month=2026-12&kind=expense');
      await agent.get('/api/dashboard?month=2026-11');
      const rows = await db.all('SELECT competence_month, due_on FROM transactions WHERE recurrence_id = ? ORDER BY competence_month', [recurrence.id]);
      expect(rows.map((r) => r.competence_month)).toEqual(['2026-10', '2026-11', '2026-12']);
      expect(rows[0].due_on).toBe('2026-10-10');
    });

    it('mudança de valor só afeta futuras não efetivadas e não editadas', async () => {
      const { recurrence } = await ok(
        await agent.post('/api/recurrences').send({
          kind: 'income',
          description: 'Salário dia 30',
          amount_cents: 333536,
          account_id: ids.bradesco,
          day_of_month: 30,
          start_month: '2026-09',
        }),
        201,
      );
      const occ = await db.all('SELECT id, competence_month FROM transactions WHERE recurrence_id = ? ORDER BY competence_month', [recurrence.id]);
      const [sep, oct, nov] = occ;
      await ok(await agent.post(`/api/transactions/${sep.id}/pay`).send({ paid_on: '2026-09-30' }));
      await ok(await agent.patch(`/api/transactions/${nov.id}`).send({ amount_cents: 350000 }));
      await ok(await agent.patch(`/api/recurrences/${recurrence.id}`).send({ amount_cents: 400000 }));
      const after = await db.all('SELECT competence_month, amount_cents, overridden FROM transactions WHERE recurrence_id = ? ORDER BY competence_month', [recurrence.id]);
      expect(after.map((r) => [r.competence_month, Number(r.amount_cents)])).toEqual([
        ['2026-09', 333536],
        ['2026-10', 400000],
        ['2026-11', 350000],
        ['2026-12', 400000],
      ]);
      expect(oct).toBeTruthy();
    });

    it('editar a data de uma ocorrência muda o vencimento só no mesmo mês', async () => {
      const { recurrence } = await ok(
        await agent.post('/api/recurrences').send({ kind: 'income', description: 'Salário', amount_cents: 100000, account_id: ids.bradesco, day_of_month: 30, start_month: '2026-10' }),
        201,
      );
      const [oct] = await db.all('SELECT id FROM transactions WHERE recurrence_id = ? ORDER BY competence_month', [recurrence.id]);
      const tx = await ok(await agent.patch(`/api/transactions/${oct.id}`).send({ occurred_on: '2026-10-28', description: null }));
      expect([tx.occurred_on, tx.due_on, tx.competence_month, tx.overridden]).toEqual(['2026-10-28', '2026-10-28', '2026-10', 1]);
      expect(tx.description).toBe('Salário');
      expect((await agent.patch(`/api/transactions/${oct.id}`).send({ occurred_on: '2026-11-02' })).status).toBe(400);
    });

    it('editar a fixa a partir de um mês muda nome, valor e dia só dali em diante', async () => {
      const { recurrence } = await ok(
        await agent.post('/api/recurrences').send({ kind: 'income', description: 'Receita fixa', amount_cents: 333536, account_id: ids.bradesco, day_of_month: 30, start_month: '2026-10' }),
        201,
      );
      await ok(
        await agent.patch(`/api/recurrences/${recurrence.id}`).send({ description: 'Salário', amount_cents: 340000, day_of_month: 5, from_month: '2026-11' }),
      );
      const rows = await db.all('SELECT competence_month, description, amount_cents, due_on FROM transactions WHERE recurrence_id = ? ORDER BY competence_month', [
        recurrence.id,
      ]);
      expect(rows.map((r) => [r.competence_month, r.description, Number(r.amount_cents), r.due_on])).toEqual([
        ['2026-10', 'Receita fixa', 333536, '2026-10-30'],
        ['2026-11', 'Salário', 340000, '2026-11-05'],
        ['2026-12', 'Salário', 340000, '2026-12-05'],
      ]);
    });

    it('encerrar não apaga o passado e para de gerar', async () => {
      const { recurrence } = await ok(
        await agent.post('/api/recurrences').send({ kind: 'expense', description: 'Academia', amount_cents: 9000, account_id: ids.bradesco, day_of_month: 5, start_month: '2026-09' }),
        201,
      );
      await ok(await agent.post(`/api/recurrences/${recurrence.id}/end`).send({ end_month: '2026-10' }));
      await agent.get('/api/transactions?month=2027-01&kind=expense');
      const rows = await db.all('SELECT competence_month FROM transactions WHERE recurrence_id = ? AND deleted_at IS NULL ORDER BY competence_month', [recurrence.id]);
      expect(rows.map((r) => r.competence_month)).toEqual(['2026-09', '2026-10']);
    });

    it('recorrência no cartão cai na fatura do mês', async () => {
      const { recurrence } = await ok(
        await agent.post('/api/recurrences').send({ kind: 'expense', description: 'Netflix', amount_cents: 5590, card_id: ids.ultra, day_of_month: 12, start_month: '2026-11' }),
        201,
      );
      const rows = await db.all(
        'SELECT t.competence_month, t.occurred_on, i.reference_month FROM transactions t JOIN invoices i ON i.id = t.invoice_id WHERE recurrence_id = ? ORDER BY competence_month',
        [recurrence.id],
      );
      expect(rows[0]).toEqual({ competence_month: '2026-11', occurred_on: '2026-09-12', reference_month: '2026-11' });
      expect(rows.every((r) => r.competence_month === r.reference_month)).toBe(true);
    });
  });

  describe('parcelamentos', () => {
    it('em conta: parcelas mensais que somam exatamente o total', async () => {
      const { plan } = await ok(
        await agent.post('/api/installments').send({ description: 'IPVA', total_cents: 10000, installments: 3, account_id: ids.bradesco, purchased_on: '2026-10-31' }),
        201,
      );
      const rows = await db.all('SELECT installment_no, amount_cents, due_on, status FROM transactions WHERE plan_id = ? ORDER BY installment_no', [plan.id]);
      expect(rows.map((r) => [r.installment_no, Number(r.amount_cents), r.due_on, r.status])).toEqual([
        [1, 3334, '2026-10-31', 'planned'],
        [2, 3333, '2026-11-30', 'planned'],
        [3, 3333, '2026-12-31', 'planned'],
      ]);
      const view = await ok(await agent.get('/api/transactions?month=2026-11&kind=expense'));
      expect(view.items[0].installment_label).toBe('2/3');
      expect(view.summary.recurrence.installment).toBe(3333);
    });

    it('no cartão: cada parcela numa fatura seguinte, ocupando limite', async () => {
      await ok(
        await agent.post('/api/installments').send({ description: 'Notebook', total_cents: 270000, installments: 6, card_id: ids.ultra, purchased_on: '2026-10-08' }),
        201,
      );
      const invoices = await ok(await agent.get(`/api/cards/${ids.ultra}/invoices?from=2026-11&to=2027-05`));
      expect(invoices.map((i: any) => [i.reference_month, i.total_cents])).toEqual([
        ['2026-11', 0],
        ['2026-12', 45000],
        ['2027-01', 45000],
        ['2027-02', 45000],
        ['2027-03', 45000],
        ['2027-04', 45000],
        ['2027-05', 45000],
      ]);
      const [card] = await ok(await agent.get('/api/cards'));
      expect(card.committed_cents).toBe(270000);
      const year = await ok(await agent.get('/api/reports/year?year=2026&mode=planned'));
      const loose = year.expense.rows.find((r: any) => r.name === 'Sem categoria');
      expect(loose.card_name).toBe('Ultra');
      expect(loose.items[0]).toMatchObject({ name: 'Notebook · 6x', card_name: 'Ultra' });
      expect(card.available_cents).toBe(1410000 - 270000);
    });

    it('cancela só o restante ainda não pago', async () => {
      const { plan } = await ok(
        await agent.post('/api/installments').send({ description: 'Sofá', total_cents: 30000, installments: 3, account_id: ids.bradesco, purchased_on: '2026-10-01', first_paid: true }),
        201,
      );
      const res = await ok(await agent.post(`/api/installments/${plan.id}/cancel`).send({}));
      expect(res.cancelled).toBe(2);
      expect(res.plan.active_count).toBe(1);
      expect(res.plan.settled_count).toBe(1);
    });

    it('rejeita parcela repetida no mesmo plano', async () => {
      const { plan } = await ok(await agent.post('/api/installments').send({ description: 'X', total_cents: 200, installments: 2, account_id: ids.bradesco }), 201);
      const user = await db.get('SELECT id FROM users LIMIT 1');
      await expect(
        db.run(
          "INSERT INTO transactions (client_uuid, household_id, kind, amount_cents, occurred_on, competence_month, account_id, plan_id, installment_no, status, created_by, created_at, updated_at) VALUES ('dup-1', 1, 'expense', 100, '2026-10-08', '2026-10', ?, ?, 1, 'planned', ?, 'x', 'x')",
          [ids.bradesco, plan.id, user.id],
        ),
      ).rejects.toThrow(/unique/i);
    });
  });

  describe('cartões e faturas', () => {
    it('TESTE CRÍTICO: compra de R$ 500 + pagamento de R$ 500 = despesa de R$ 500 e saída de caixa de R$ 500', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Mercado', amount_cents: 50000, occurred_on: '2026-09-05', card_id: ids.ultra }), 201);

      // Compra no cartão não tira dinheiro da conta ainda.
      expect((await balanceOf(ids.bradesco)).current_balance_cents).toBe(450000);

      const view = await ok(await agent.get('/api/transactions?month=2026-10&kind=expense'));
      const invoiceId = view.invoices[0].id;
      await ok(await agent.post(`/api/invoices/${invoiceId}/payments`).send({ amount_cents: 50000, paid_on: '2026-10-06' }), 201);

      const after = await ok(await agent.get('/api/transactions?month=2026-10&kind=expense'));
      expect(after.summary.total_cents).toBe(50000);
      expect(after.invoices[0].remaining_cents).toBe(0);

      const dash = await ok(await agent.get('/api/dashboard?month=2026-10'));
      expect(dash.expense.total_cents).toBe(50000);

      const year = await ok(await agent.get('/api/reports/year?year=2026'));
      expect(year.expense.total_cents).toBe(50000);

      expect((await balanceOf(ids.bradesco)).current_balance_cents).toBe(450000 - 50000);
      const expenseRows = await db.get("SELECT COUNT(*) AS n, SUM(amount_cents) AS s FROM transactions WHERE kind = 'expense' AND deleted_at IS NULL");
      expect(Number(expenseRows.n)).toBe(1);
      expect(Number(expenseRows.s)).toBe(50000);
    });

    it('compra entra na fatura pelo fechamento', async () => {
      const a = await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 100, occurred_on: '2026-10-06', card_id: ids.ultra }), 201);
      const b = await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 100, occurred_on: '2026-10-07', card_id: ids.ultra }), 201);
      expect(a.transaction.competence_month).toBe('2026-11');
      expect(b.transaction.competence_month).toBe('2026-12');
    });

    it('pagamento parcial e múltiplo, com limite liberado', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 873601, occurred_on: '2026-09-05', card_id: ids.ultra }), 201);
      let [card] = await ok(await agent.get('/api/cards'));
      expect(card.available_cents).toBe(536399);
      const invoice = await ok(await agent.get(`/api/cards/${ids.ultra}/invoices/2026-10`));
      await ok(await agent.post(`/api/invoices/${invoice.id}/payments`).send({ amount_cents: 500000 }), 201);
      const detail = (await ok(await agent.post(`/api/invoices/${invoice.id}/payments`).send({}), 201)).invoice;
      expect(detail.payments.map((p: any) => p.amount_cents)).toEqual([500000, 373601]);
      expect(detail.remaining_cents).toBe(0);
      expect(detail.state).toBe('paid');
      [card] = await ok(await agent.get('/api/cards'));
      expect(card.available_cents).toBe(1410000);
    });

    it('pagamento maior que a fatura vira crédito na próxima, sem virar receita', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 50000, occurred_on: '2026-09-05', card_id: ids.ultra }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 30000, occurred_on: '2026-10-01', card_id: ids.ultra }), 201);
      const oct = await ok(await agent.get(`/api/cards/${ids.ultra}/invoices/2026-10`));
      await ok(await agent.post(`/api/invoices/${oct.id}/payments`).send({ amount_cents: 70000 }), 201);
      const nov = await ok(await agent.get(`/api/cards/${ids.ultra}/invoices/2026-11`));
      expect(nov.credit_in_cents).toBe(20000);
      expect(nov.remaining_cents).toBe(10000);
      const dash = await ok(await agent.get('/api/dashboard?month=2026-10'));
      expect(dash.income.total_cents).toBe(0);
      expect((await balanceOf(ids.bradesco)).current_balance_cents).toBe(450000 - 70000);
    });

    it('pagar a fatura confirma cobranças previstas sem liberar limite a mais', async () => {
      await ok(
        await agent.post('/api/recurrences').send({ kind: 'expense', description: 'Netflix', amount_cents: 5590, card_id: ids.ultra, day_of_month: 12, start_month: '2026-09' }),
        201,
      );
      await ok(await agent.get('/api/transactions?month=2026-11&kind=expense'));
      const nov = await ok(await agent.get(`/api/cards/${ids.ultra}/invoices/2026-11`));
      expect(nov.total_cents).toBe(5590);
      await ok(await agent.post(`/api/invoices/${nov.id}/payments`).send({}), 201);
      const [card] = await ok(await agent.get('/api/cards'));
      expect(card.available_cents).toBe(1410000);
      const row = await db.get("SELECT status FROM transactions WHERE description = 'Netflix' AND occurred_on = '2026-09-12'");
      expect(row.status).toBe('posted');
    });

    it('fatura a pagar entra no saldo previsto da conta padrão', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 187406, occurred_on: '2026-10-01', card_id: ids.ultra }), 201);
      expect((await balanceOf(ids.bradesco, '2026-10')).forecast_balance_cents).toBe(450000);
      expect((await balanceOf(ids.bradesco, '2026-11')).forecast_balance_cents).toBe(450000 - 187406);
    });

    it('reajustar fatura soma a diferença na mesma fatura e recusa reduzir', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 50000, occurred_on: '2026-09-05', card_id: ids.ultra }), 201);
      const inv = await ok(await agent.get(`/api/cards/${ids.ultra}/invoices/2026-10`));
      const after = await ok(await agent.post(`/api/invoices/${inv.id}/adjust`).send({ total_cents: 52345 }), 201);
      expect(after.total_cents).toBe(52345);
      expect(after.transactions.find((t: any) => t.description === 'Ajuste de fatura')).toMatchObject({ amount_cents: 2345, competence_month: '2026-10' });
      expect((await agent.post(`/api/invoices/${inv.id}/adjust`).send({ total_cents: 100 })).status).toBe(400);

      const month = await ok(await agent.get('/api/cards/month/2026-10'));
      expect(month).toEqual([{ card_id: ids.ultra, invoice: expect.objectContaining({ id: inv.id, total_cents: 52345 }) }]);
      const empty = await ok(await agent.get('/api/cards/month/2027-05'));
      expect(empty[0].invoice).toMatchObject({ id: null, total_cents: 0, state: 'future' });
    });

    it('excluir pagamento devolve o saldo', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 50000, occurred_on: '2026-09-05', card_id: ids.ultra }), 201);
      const inv = await ok(await agent.get(`/api/cards/${ids.ultra}/invoices/2026-10`));
      const { id } = await ok(await agent.post(`/api/invoices/${inv.id}/payments`).send({}), 201);
      await ok(await agent.delete(`/api/invoice-payments/${id}`));
      expect((await balanceOf(ids.bradesco)).current_balance_cents).toBe(450000);
    });
  });

  describe('dashboard, orçamento e ano', () => {
    it('visão anual soma meses e agrupa filhas no pai', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 1000, occurred_on: '2026-01-10', account_id: ids.bradesco, category_id: ids.cat['Mercado'] }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 2000, occurred_on: '2026-02-10', account_id: ids.bradesco, category_id: ids.cat['Restaurante'] }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 500, occurred_on: '2026-11-10', account_id: ids.bradesco, category_id: ids.cat['Mercado'] }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'income', amount_cents: 9000, occurred_on: '2026-01-05', account_id: ids.bradesco, category_id: ids.cat['Salário'] }), 201);

      const realized = await ok(await agent.get('/api/reports/year?year=2026&mode=realized'));
      const food = realized.expense.rows.find((r: any) => r.name === 'Alimentação');
      expect(food.months.slice(0, 2)).toEqual([1000, 2000]);
      expect(food.total_cents).toBe(3000);
      expect(food.children.map((c: any) => c.name)).toEqual(['Mercado', 'Restaurante']);
      expect(realized.balance.months[0]).toBe(8000);
      expect(realized.balance.total_cents).toBe(9000 - 3000);

      const planned = await ok(await agent.get('/api/reports/year?year=2026&mode=planned'));
      expect(planned.expense.total_cents).toBe(3500);
    });

    it('início lista os próximos vencimentos, com atrasados primeiro', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Luz', amount_cents: 15000, occurred_on: '2026-10-02', account_id: ids.bradesco, paid: false }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'income', description: 'Freela', amount_cents: 80000, occurred_on: '2026-10-20', account_id: ids.bradesco }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Longe', amount_cents: 100, occurred_on: '2026-12-20', account_id: ids.bradesco }), 201);
      const dash = await ok(await agent.get('/api/dashboard?month=2026-10'));
      const txs = dash.upcoming.filter((u: any) => u.type === 'tx');
      expect(txs.map((u: any) => [u.description, u.overdue])).toEqual([
        ['Luz', true],
        ['Freela', false],
      ]);
    });

    it('avatar sobe de nível com XP e só aceita itens liberados', async () => {
      const first = await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 100, occurred_on: '2026-10-08', account_id: ids.bradesco }), 201);
      expect(first.xp.level_up).toBeUndefined();
      const base = { color: '#1CB0F6', skin: '#FFDBB4', hat: null, face: null, neck: null };
      expect((await agent.put('/api/gamification/avatar').send({ ...base, hat: 'cap' })).status).toBe(400);

      let levelUp: number | undefined;
      for (let i = 0; i < 5 && !levelUp; i++) {
        const r = await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 100, occurred_on: '2026-10-08', account_id: ids.bradesco }), 201);
        levelUp = r.xp.level_up;
      }
      expect(levelUp).toBe(2);
      const saved = await ok(await agent.put('/api/gamification/avatar').send({ ...base, hat: 'cap' }));
      expect(saved).toMatchObject({ level: 2, title: 'Aprendiz', avatar: { ...base, hat: 'cap' } });
      const g = await ok(await agent.get('/api/gamification'));
      expect(g.members[0]).toMatchObject({ me: true, avatar: { hat: 'cap' } });
    });

    it('visão anual mostra a composição de cada categoria pela descrição', async () => {
      const post = (description: string, amount_cents: number, occurred_on: string) =>
        agent.post('/api/transactions').send({ kind: 'income', description, amount_cents, occurred_on, account_id: ids.bradesco, category_id: ids.cat['Salário'] });
      await ok(await post('Salário dia 15', 300000, '2026-01-15'), 201);
      await ok(await post('Salário dia 30', 200000, '2026-01-30'), 201);
      await ok(await post('Salário dia 15', 300000, '2026-02-15'), 201);
      await ok(await post('', 1000, '2026-02-20'), 201);

      const year = await ok(await agent.get('/api/reports/year?year=2026&mode=realized'));
      const salario = year.income.rows.find((r: any) => r.name === 'Pagamentos').children[0];
      expect(salario.months.slice(0, 2)).toEqual([500000, 301000]);
      expect(salario.items).toEqual([
        { key: 'd:Salário dia 15', name: 'Salário dia 15', fixed: false, card_name: null, months: [300000, 300000, ...Array(10).fill(0)], total_cents: 600000 },
        { key: 'd:Salário dia 30', name: 'Salário dia 30', fixed: false, card_name: null, months: [200000, ...Array(11).fill(0)], total_cents: 200000 },
        { key: 'd:', name: 'Sem descrição', fixed: false, card_name: null, months: [0, 1000, ...Array(10).fill(0)], total_cents: 1000 },
      ]);
    });

    it('duas fixas com o mesmo nome viram duas linhas, e cada célula lista seus lançamentos', async () => {
      for (const [day, amount] of [
        [15, 499436],
        [30, 333536],
      ]) {
        await ok(
          await agent.post('/api/recurrences').send({
            kind: 'income', description: 'Receita fixa', amount_cents: amount, day_of_month: day, start_month: '2026-10', account_id: ids.bradesco, category_id: ids.cat['Salário'], first_paid: true,
          }),
          201,
        );
      }
      const year = await ok(await agent.get('/api/reports/year?year=2026&mode=planned'));
      const salario = year.income.rows.find((r: any) => r.name === 'Pagamentos').children[0];
      expect(salario.items.map((i: any) => [i.name, i.fixed, i.months[9]])).toEqual([
        ['Receita fixa · dia 15', true, 499436],
        ['Receita fixa · dia 30', true, 333536],
      ]);

      const base = `/api/reports/year/transactions?year=2026&mode=planned&kind=income&month=10`;
      const cell = await ok(await agent.get(`${base}&category=${ids.cat['Salário']}&item=${encodeURIComponent(salario.items[1].key)}`));
      expect(cell.transactions.map((t: any) => t.amount_cents)).toEqual([333536]);
      const parent = await ok(await agent.get(`${base}&category=${ids.cat['Pagamentos']}&tree=1`));
      expect(parent.total_cents).toBe(499436 + 333536);
      const all = await ok(await agent.get(`/api/reports/year/transactions?year=2026&mode=planned&kind=income`));
      expect(all.total_cents).toBe(year.income.total_cents);
    });

    it('orçamento mostra gasto da categoria pai somando filhas', async () => {
      await ok(await agent.put('/api/budgets').send({ category_id: ids.cat['Alimentação'], month: '2026-10', planned_cents: 100000 }));
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 72000, occurred_on: '2026-10-02', account_id: ids.bradesco, category_id: ids.cat['Mercado'] }), 201);
      const b = await ok(await agent.get('/api/budgets?month=2026-10'));
      expect(b.items.find((i: any) => i.name === 'Alimentação')).toMatchObject({ planned_cents: 100000, spent_cents: 72000 });
      const dash = await ok(await agent.get('/api/dashboard?month=2026-10'));
      expect(dash.missions.find((m: any) => m.type === 'stay_under_budget')).toMatchObject({ target: 100000, progress: 72000 });
      expect(dash.categories[0]).toMatchObject({ name: 'Alimentação', total_cents: 72000 });
    });
  });

  describe('metas e gamificação', () => {
    it('lançamento dá +10 XP, conquista e sequência', async () => {
      const res = await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 100, account_id: ids.bradesco }), 201);
      expect(res.xp).toEqual({ xp: 10, achievements: ['first_tx'] });
      const g = await ok(await agent.get('/api/gamification'));
      expect(g.total_xp).toBe(10);
      expect(g.level).toBe(1);
      expect(g.streak.current_days).toBe(1);
      expect(g.achievements.find((a: any) => a.code === 'first_tx').unlocked).toBe(true);
    });

    it('revisão semanal e fechamento de mês valem uma vez', async () => {
      expect((await ok(await agent.post('/api/gamification/week-review').send({}))).xp).toBe(20);
      expect((await ok(await agent.post('/api/gamification/week-review').send({}))).xp).toBe(0);
      const closed = await ok(await agent.post('/api/gamification/close-month').send({ month: '2026-09' }));
      expect(closed.xp).toBe(50);
      expect(closed.achievements).toContain('month_balanced');
      expect((await agent.post('/api/gamification/close-month').send({ month: '2026-10' })).status).toBe(400);
      const g = await ok(await agent.get('/api/gamification'));
      expect(g.total_xp).toBe(70);
      expect(g.level).toBe(2);
    });

    it('meta concluída dá XP uma vez', async () => {
      const goal = await ok(await agent.post('/api/goals').send({ name: 'Viagem', target_cents: 1000000, saved_cents: 400000 }), 201);
      expect(goal.progress).toBe(0.4);
      const done = await ok(await agent.post(`/api/goals/${goal.id}/deposit`).send({ amount_cents: 600000 }));
      expect(done.goal.completed_at).toBeTruthy();
      expect(done.xp.xp).toBe(100);
      expect(done.xp.achievements).toContain('first_goal');
      const again = await ok(await agent.post(`/api/goals/${goal.id}/deposit`).send({ amount_cents: 100 }));
      expect(again.xp.xp).toBe(0);
    });
  });

  describe('acesso e calendário do casal', () => {
    it('informa se o cadastro está aberto e recusa casa nova quando fechado', async () => {
      expect((await request(app).get('/api/auth/options')).body).toEqual({ register_open: true });
      const closed = createApp(db, { ...loadConfig({ ALLOW_REGISTER: 'false' }), fixedToday: TODAY });
      const res = await request(closed).post('/api/auth/register').send({
        household_name: 'Casa',
        name: 'Diego',
        email: 'novo@x.com',
        password: 'senha-segura',
      });
      expect(res.status).toBe(403);
    });

    it('troca a própria senha e o admin redefine a de um membro da casa', async () => {
      await ok(await agent.post('/api/users').send({ name: 'Jhersyka', email: 'j@x.com', password: 'senha-segura' }), 201);
      const member = request.agent(app);
      await ok(await member.post('/api/auth/login').send({ email: 'j@x.com', password: 'senha-segura' }));
      expect((await agent.post('/api/auth/password').send({ current_password: 'errada', new_password: 'senha-nova-1' })).status).toBe(401);
      expect((await agent.post('/api/auth/password').send({ current_password: 'senha-segura', new_password: 'senha-nova-1' })).status).toBe(204);
      expect((await request(app).post('/api/auth/login').send({ email: 'diego@x.com', password: 'senha-segura' })).status).toBe(401);
      expect((await request(app).post('/api/auth/login').send({ email: 'diego@x.com', password: 'senha-nova-1' })).status).toBe(200);
      const users = await ok(await agent.get('/api/users'));
      const memberId = users.find((u: { email: string }) => u.email === 'j@x.com').id;
      expect((await member.post(`/api/users/${ids.bradesco}/password`).send({ password: 'senha-nova-2' })).status).toBe(403);
      expect((await agent.post(`/api/users/${memberId}/password`).send({ password: 'senha-nova-2' })).status).toBe(204);
      expect((await request(app).post('/api/auth/login').send({ email: 'j@x.com', password: 'senha-nova-2' })).status).toBe(200);
    });

    it('soma os dois salários em Nós e separa cada pessoa', async () => {
      await ok(await agent.post('/api/users').send({ name: 'Jhersyka', email: 'jhersyka@x.com', password: 'senha-segura' }), 201);
      const users = await ok(await agent.get('/api/users'));
      const hers = users.find((u: { email: string }) => u.email === 'jhersyka@x.com');
      const me = await ok(await agent.get('/api/auth/me'));
      await ok(await agent.post('/api/transactions').send({ kind: 'income', description: 'Salário Diego', amount_cents: 100000, occurred_on: '2026-10-05', account_id: ids.bradesco, for_user_id: me.id }), 201);
      const hersSalary = await ok(await agent.post('/api/transactions').send({ kind: 'income', description: 'Salário Jhersyka', amount_cents: 80000, occurred_on: '2026-10-05', account_id: ids.bradesco, for_user_id: hers.id }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Aluguel', amount_cents: 5000, occurred_on: '2026-10-15', due_on: '2026-10-15', account_id: ids.bradesco, paid: false }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Gasolina', amount_cents: 4000, occurred_on: '2026-10-01', card_id: ids.ultra }), 201);
      expect((await agent.post('/api/transactions').send({ kind: 'income', description: 'Fora', amount_cents: 100, account_id: ids.bradesco, for_user_id: 99999 })).status).toBe(400);

      const both = await ok(await agent.get('/api/transactions?month=2026-10&kind=income&person=all'));
      expect(both.summary.total_cents).toBe(180000);
      const mine = await ok(await agent.get('/api/transactions?month=2026-10&kind=income&person=me'));
      expect(mine.items.map((item: { description: string }) => item.description)).toEqual(['Salário Diego']);
      const onlyHers = await ok(await agent.get(`/api/transactions?month=2026-10&kind=income&person=${hers.id}`));
      expect(onlyHers.items.map((item: { description: string }) => item.description)).toEqual(['Salário Jhersyka']);
      const houseExpenses = await ok(await agent.get('/api/transactions?month=2026-10&kind=expense&person=all'));
      expect(houseExpenses.items.map((item: { description: string }) => item.description)).toContain('Aluguel');
      const november = await ok(await agent.get('/api/transactions?month=2026-11&kind=expense&person=all'));
      expect(november.invoices.some((invoice: { card_name: string }) => invoice.card_name === 'Ultra')).toBe(true);
      const mineExpenses = await ok(await agent.get('/api/transactions?month=2026-11&kind=expense&person=me'));
      expect(mineExpenses.items).toEqual([]);
      expect(mineExpenses.invoices).toEqual([]);

      const dash = await ok(await agent.get('/api/dashboard?month=2026-10&person=all'));
      expect(dash.income.total_cents).toBe(180000);
      const dashMe = await ok(await agent.get('/api/dashboard?month=2026-10&person=me'));
      expect(dashMe.income.total_cents).toBe(100000);
      expect(dashMe.invoice).toBeNull();

      const cal = await ok(await agent.get('/api/calendar?month=2026-10&person=all'));
      const descriptions = cal.items.map((item: { description: string }) => item.description);
      expect(descriptions).toEqual(expect.arrayContaining(['Salário Diego', 'Salário Jhersyka', 'Aluguel']));
      expect(descriptions).not.toContain('Gasolina');
      const hersItem = cal.items.find((item: { description: string }) => item.description === 'Salário Jhersyka');
      expect(hersItem).toMatchObject({ who: 'other', tx_id: hersSalary.transaction.id });
      const calMe = await ok(await agent.get('/api/calendar?month=2026-10&person=me'));
      expect(calMe.items.map((item: { description: string }) => item.description)).toEqual(['Salário Diego']);

      const member = request.agent(app);
      await ok(await member.post('/api/auth/login').send({ email: 'jhersyka@x.com', password: 'senha-segura' }));
      expect((await member.get(`/api/transactions/${hersSalary.transaction.id}`)).status).toBe(200);
    });
  });

  describe('digital e Face ID', () => {
    const origin = 'http://localhost:5173';

    it('pede um endereço https com nome e recusa IP', async () => {
      expect((await request(app).post('/api/auth/webauthn/login/options')).status).toBe(400);
      const ip = await request(app).post('/api/auth/webauthn/login/options').set('Origin', 'http://192.168.0.10:3003');
      expect(ip.status).toBe(400);
      expect(ip.body.error).toMatch(/https/);
    });

    it('abre a cerimônia no localhost e recusa uma resposta inventada', async () => {
      expect((await request(app).post('/api/auth/webauthn/register/options').set('Origin', origin)).status).toBe(401);
      const options = await ok(await request(app).post('/api/auth/webauthn/login/options').set('Origin', origin));
      expect(options.rpId).toBe('localhost');
      expect(options.userVerification).toBe('required');
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin })).toString('base64url');
      const forged = await request(app)
        .post('/api/auth/webauthn/login/verify')
        .set('Origin', origin)
        .send({
          response: {
            id: 'cred-inventada',
            rawId: 'cred-inventada',
            type: 'public-key',
            response: { clientDataJSON, authenticatorData: 'aa', signature: 'bb' },
            clientExtensionResults: {},
          },
        });
      expect(forged.status).toBe(400);
    });

    it('cada pessoa só apaga a própria chave', async () => {
      expect((await agent.get('/api/auth/webauthn')).body).toEqual([]);
      const registered = await ok(await agent.post('/api/auth/webauthn/register/options').set('Origin', origin));
      expect(registered.authenticatorSelection.authenticatorAttachment).toBe('platform');
      const me = await ok(await agent.get('/api/auth/me'));
      await db.run(
        'INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, device_label, created_at) VALUES (?, ?, ?, 0, ?, ?)',
        [me.id, 'chave-do-diego', 'cHVi', 'iPhone', new Date().toISOString()],
      );
      const list = await ok(await agent.get('/api/auth/webauthn'));
      expect(list.map((row: { credential_id: string }) => row.credential_id)).toEqual(['chave-do-diego']);
      const other = await register('outra-chave@x.com', 'Outra casa');
      expect((await other.delete(`/api/auth/webauthn/${list[0].id}`)).status).toBe(404);
      expect((await agent.delete(`/api/auth/webauthn/${list[0].id}`)).status).toBe(204);
      expect((await agent.get('/api/auth/webauthn')).body).toEqual([]);
      expect((await agent.delete('/api/auth/webauthn/999')).status).toBe(404);
    });

    it('usa o host fixo do túnel quando ele está configurado', async () => {
      const pinned = createApp(db, { ...loadConfig({}), fixedToday: TODAY, webauthnRpId: 'familia.example', webauthnOrigin: 'https://familia.example' });
      const options = await ok(await request(pinned).post('/api/auth/webauthn/login/options'));
      expect(options.rpId).toBe('familia.example');
    });
  });
});
