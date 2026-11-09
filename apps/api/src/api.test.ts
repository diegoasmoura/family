import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDb, migrate, type Db } from '@fin/db';
import { createApp } from './app';
import { loadConfig } from './config';
import { backfillTithes } from './modules/tithe';

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

    it('a sessão vai no cookie HttpOnly e o logout apaga', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'diego@x.com', password: 'senha-segura' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('eyJ');
      const set = res.headers['set-cookie'];
      const cookie = (Array.isArray(set) ? set : [set]).join(';');
      expect(cookie).toMatch(/fin_session=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);
      const out = await request(app).post('/api/auth/logout');
      const cleared = out.headers['set-cookie'];
      const gone = (Array.isArray(cleared) ? cleared : [cleared]).join(';');
      expect(gone).toMatch(/fin_session=/);
      expect(gone).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it('a 31ª tentativa de login na janela é recusada', async () => {
      const isolated = createApp(db, { ...loadConfig({}), fixedToday: TODAY });
      for (let i = 0; i < 30; i++) {
        expect((await request(isolated).post('/api/auth/login').send({ email: 'ninguem@x.com', password: 'x' })).status).toBe(401);
      }
      expect((await request(isolated).post('/api/auth/login').send({ email: 'ninguem@x.com', password: 'x' })).status).toBe(429);
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

    it('correção do fim do mês altera o previsto e não vira receita nem despesa', async () => {
      const before = await balanceOf(ids.bradesco, '2026-10');
      const corrected = await ok(await agent.put(`/api/accounts/${ids.bradesco}/closing`).send({ month: '2026-10', closing_cents: 120000 }));
      expect(corrected.month_closing_cents).toBe(120000);
      expect(corrected.forecast_balance_cents).toBe(120000);
      expect(corrected.current_balance_cents).toBe(before.current_balance_cents);
      const dash = await ok(await agent.get('/api/dashboard?month=2026-10'));
      expect(dash.income.total_cents).toBe(0);
      expect(dash.expense.total_cents).toBe(0);
      expect(dash.balance.forecast_cents).toBe(120000);
      const undone = await ok(await agent.delete(`/api/accounts/${ids.bradesco}/closing?month=2026-10`));
      expect(undone.month_closing_cents).toBeNull();
      expect(undone.forecast_balance_cents).toBe(before.forecast_balance_cents);
    });

    it('transferência move saldo sem virar receita nem despesa', async () => {
      await ok(await agent.post('/api/transfers').send({ from_account_id: ids.bradesco, to_account_id: ids.nubank, amount_cents: 100000, occurred_on: '2026-10-07' }), 201);
      expect((await balanceOf(ids.bradesco)).current_balance_cents).toBe(350000);
      expect((await balanceOf(ids.nubank)).current_balance_cents).toBe(100000);
      const dash = await ok(await agent.get('/api/dashboard'));
      expect(dash.income.total_cents).toBe(0);
      expect(dash.expense.total_cents).toBe(0);
      expect(dash.balance.current_cents).toBe(450000);
      // Contas por mês: cada conta mostra o que entrou e saiu nela; o total da casa não conta a transferência.
      const october = await ok(await agent.get('/api/accounts?month=2026-10'));
      expect(october.accounts.find((a: any) => a.id === ids.bradesco).month_flow).toMatchObject({ in_cents: 0, out_cents: 100000 });
      expect(october.accounts.find((a: any) => a.id === ids.nubank).month_flow).toMatchObject({ in_cents: 100000, out_cents: 0 });
      expect(october.month_flow).toMatchObject({ in_cents: 0, out_cents: 0 });
      expect((await ok(await agent.get('/api/accounts?month=2026-11'))).accounts.find((a: any) => a.id === ids.nubank).month_flow.in_cents).toBe(0);
      expect((await agent.post('/api/transfers').send({ from_account_id: ids.bradesco, to_account_id: ids.bradesco, amount_cents: 1 })).status).toBe(400);
    });

    it('recomeçar do zero: as contas valem a partir do dia 1º do mês, o histórico fica e só o administrador faz', async () => {
      const conta = (await ok(await agent.post('/api/accounts').send({ name: 'Conta velha', type: 'checking', initial_balance_cents: 500000, initial_balance_on: '2026-08-01' }), 201)).id;
      const lanc = (body: Record<string, unknown> & { kind: string }) => agent.post('/api/transactions').send({ account_id: conta, ...(body.kind === 'expense' ? { category_id: ids.cat['Mercado'] } : {}), ...body });
      await ok(await lanc({ kind: 'income', amount_cents: 300000, occurred_on: '2026-08-10' }), 201);
      await ok(await lanc({ kind: 'expense', amount_cents: 100000, occurred_on: '2026-09-05' }), 201);
      await ok(await lanc({ kind: 'expense', amount_cents: 40000, occurred_on: '2026-09-20', due_on: '2026-09-20', paid: false, description: 'Conta velha em aberto' }), 201);
      await ok(await lanc({ kind: 'expense', amount_cents: 25000, occurred_on: '2026-10-03' }), 201);
      await ok(await agent.put(`/api/accounts/${conta}/closing`).send({ month: '2026-09', closing_cents: 123456 }));
      expect((await balanceOf(conta, '2026-10')).current_balance_cents + 0).not.toBe(0);
      const setembroAntes = await ok(await agent.get('/api/dashboard?month=2026-09&person=all'));

      // prévia: o que fica para trás
      const prev = await ok(await agent.get('/api/accounts/restart/preview?month=2026-10'));
      expect(prev.date).toBe('2026-10-01');
      expect(prev.accounts.find((a: any) => a.id === conta).ignored_movements).toBe(2); // receita de ago e despesa de set
      expect(prev.pending_expenses).toEqual({ count: 1, total_cents: 40000 });

      // recomeçar com saldo zero
      const res = await ok(await agent.post('/api/accounts/restart').send({ month: '2026-10', accounts: [{ id: conta, balance_cents: 0 }] }));
      expect(res).toMatchObject({ date: '2026-10-01', accounts: 1, deleted_pending: 0 });
      const depois = await balanceOf(conta, '2026-10');
      expect(depois.current_balance_cents).toBe(-25000); // zero + só o que aconteceu a partir de 1º de outubro
      expect(depois.forecast_balance_cents).toBe(-25000); // a conta velha em aberto não pesa mais no saldo
      expect((await balanceOf(conta, '2026-09')).month_closing_cents).toBeNull(); // a correção de setembro perdeu o sentido

      // o histórico continua: relatórios e lista de setembro não mudam
      const setembroDepois = await ok(await agent.get('/api/dashboard?month=2026-09&person=all'));
      expect(setembroDepois.expense.total_cents).toBe(setembroAntes.expense.total_cents);
      const lista = await ok(await agent.get('/api/transactions?month=2026-09&kind=expense&person=all'));
      expect(lista.items.some((t: any) => t.description === 'Conta velha em aberto')).toBe(true);

      // apagar as pendências antigas é opcional
      const limpa = await ok(await agent.post('/api/accounts/restart').send({ month: '2026-10', accounts: [{ id: conta, balance_cents: 100000 }], delete_pending: true }));
      expect(limpa.deleted_pending).toBe(1);
      expect((await balanceOf(conta, '2026-10')).current_balance_cents).toBe(75000);
      const semPendencia = await ok(await agent.get('/api/transactions?month=2026-09&kind=expense&person=all'));
      expect(semPendencia.items.some((t: any) => t.description === 'Conta velha em aberto')).toBe(false);

      // tirar dos totais o que é de antes: continua na lista, sai dos relatórios, e saldo e fatura não mudam
      const agostoAntes = await ok(await agent.get('/api/dashboard?month=2026-08&person=all'));
      expect(agostoAntes.income.total_cents).toBe(300000);
      const prev2 = await ok(await agent.get('/api/accounts/restart/preview?month=2026-10'));
      expect(prev2.old_in_reports.incomes).toEqual({ count: 1, total_cents: 300000 });
      expect(prev2.old_in_reports.expenses.count).toBeGreaterThanOrEqual(1); // a despesa paga de setembro
      const saldoAntes = (await balanceOf(conta, '2026-10')).current_balance_cents;
      const out = await ok(await agent.post('/api/accounts/restart').send({ month: '2026-10', accounts: [{ id: conta, balance_cents: 100000 }], hide_old_from_reports: true }));
      expect(out.hidden_from_reports).toBeGreaterThanOrEqual(2);
      expect((await ok(await agent.get('/api/dashboard?month=2026-08&person=all'))).income.total_cents).toBe(0);
      expect((await ok(await agent.get('/api/dashboard?month=2026-09&person=all'))).expense.total_cents).toBe(0);
      expect((await ok(await agent.get('/api/dashboard?month=2026-10&person=all'))).expense.total_cents).toBe(25000); // o mês do recomeço continua contando
      const set = await ok(await agent.get('/api/transactions?month=2026-09&kind=expense&person=all'));
      expect(set.items.some((t: any) => t.amount_cents === 100000)).toBe(true); // continua na lista
      expect((await balanceOf(conta, '2026-10')).current_balance_cents).toBe(saldoAntes); // o saldo não olha esse campo

      // só administrador; e não dá para recomeçar no futuro
      await ok(await agent.post('/api/users').send({ name: 'Jhersyka', email: 'j@x.com', password: 'senha-segura' }), 201);
      const member = request.agent(app);
      await ok(await member.post('/api/auth/login').send({ email: 'j@x.com', password: 'senha-segura' }));
      expect((await member.get('/api/accounts/restart/preview?month=2026-10')).status).toBe(403);
      expect((await member.post('/api/accounts/restart').send({ month: '2026-10', accounts: [{ id: conta, balance_cents: 0 }] })).status).toBe(403);
      expect((await agent.get('/api/accounts/restart/preview?month=2026-12')).status).toBe(400);
    });

    it('arquivar conta guarda o histórico e a tira da lista', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 100, account_id: ids.nubank }), 201);
      await ok(await agent.patch(`/api/accounts/${ids.nubank}`).send({ archived: 1 }));
      const lista = await ok(await agent.get('/api/accounts'));
      expect(lista.accounts.map((a: any) => a.id)).not.toContain(ids.nubank);
      const todas = await ok(await agent.get('/api/accounts?archived=1'));
      expect(todas.accounts.find((a: any) => a.id === ids.nubank).archived).toBe(1);
    });

    it('excluir conta apaga também lançamentos, transferências, fixas e pagamentos de fatura, e avisa o que vai embora', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 7000, occurred_on: '2026-10-03', account_id: ids.nubank, description: 'Mercado' }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'income', amount_cents: 20000, occurred_on: '2026-10-04', account_id: ids.nubank, description: 'Extra' }), 201);
      await ok(await agent.post('/api/transfers').send({ from_account_id: ids.bradesco, to_account_id: ids.nubank, amount_cents: 5000, occurred_on: '2026-10-05' }), 201);
      await ok(await agent.post('/api/recurrences').send({ kind: 'expense', amount_cents: 3000, description: 'Fixa Nubank', account_id: ids.nubank, day_of_month: 10, start_month: '2026-10' }), 201);
      const before = await ok(await agent.get('/api/dashboard?month=2026-10&person=all'));

      const impact = await ok(await agent.get(`/api/accounts/${ids.nubank}/impact`));
      expect(impact.transactions).toBeGreaterThanOrEqual(3); // compra, receita e as parcelas já geradas da fixa
      expect(impact).toMatchObject({ transfers: 1, recurrences: 1 });

      const res = await ok(await agent.delete(`/api/accounts/${ids.nubank}`));
      expect(res).toMatchObject({ deleted: true });
      expect(res.removed.transactions).toBe(impact.transactions);

      const lista = await ok(await agent.get('/api/accounts?archived=1'));
      expect(lista.accounts.map((a: any) => a.id)).not.toContain(ids.nubank);
      const after = await ok(await agent.get('/api/dashboard?month=2026-10&person=all'));
      expect(after.expense.total_cents).toBeLessThan(before.expense.total_cents);
      expect(after.income.total_cents).toBeLessThan(before.income.total_cents);
      const lanc = await ok(await agent.get('/api/transactions?month=2026-10&kind=expense&person=all'));
      expect(lanc.items.some((t: any) => t.account_id === ids.nubank)).toBe(false);
      const transf = await ok(await agent.get('/api/transfers?month=2026-10'));
      expect(transf).toHaveLength(0);
      expect((await ok(await agent.get('/api/recurrences'))).some((r: any) => r.description === 'Fixa Nubank')).toBe(false);
      // o saldo da conta que sobrou volta ao que era antes da transferência
      expect((await balanceOf(ids.bradesco, '2026-10')).current_balance_cents).toBe(450000);
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

    it('outras compras só diz de quem quando todas são da mesma pessoa', async () => {
      await ok(await agent.post('/api/users').send({ name: 'Jhersyka Silva', email: 'jhersyka@x.com', password: 'senha-segura' }), 201);
      const users = await ok(await agent.get('/api/users'));
      const hers = users.find((u: { email: string }) => u.email === 'jhersyka@x.com');
      const me = await ok(await agent.get('/api/auth/me'));
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'A', amount_cents: 100, occurred_on: '2026-09-05', card_id: ids.ultra, for_user_id: me.id }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'B', amount_cents: 200, occurred_on: '2026-09-05', card_id: ids.ultra, for_user_id: hers.id }), 201);
      const mixed = await ok(await agent.get('/api/transactions?month=2026-10&kind=expense'));
      expect(mixed.invoices[0].lines.find((l: { kind: string }) => l.kind === 'other')).toEqual({
        kind: 'other',
        description: 'Outras compras',
        count: 2,
        amount_cents: 300,
      });

      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'C', amount_cents: 300, occurred_on: '2026-10-01', card_id: ids.ultra, for_user_id: hers.id }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'D', amount_cents: 400, occurred_on: '2026-10-01', card_id: ids.ultra, for_user_id: hers.id }), 201);
      const same = await ok(await agent.get('/api/transactions?month=2026-11&kind=expense'));
      expect(same.invoices[0].lines.find((l: { kind: string }) => l.kind === 'other')).toEqual({
        kind: 'other',
        description: 'Outras compras',
        count: 2,
        amount_cents: 700,
        for_user_name: 'Jhersyka',
      });
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
      expect(view.invoices[0].lines).toEqual([{ kind: 'other', description: 'Outras compras', count: 1, amount_cents: 7000, for_user_name: null }]);
      expect(view.summary).toMatchObject({
        records: 6,
        total_cents: 17000,
        total_without_cards_cents: 10000,
        not_summed_cents: 500,
        total_with_not_summed_cents: 17500,
        situation: { paid: 1000, overdue: 9000, near: 3000, planned: 4000, unpaid: 16000, cards: 0 },
        recurrence: { fixed: 0, installment: 0, variable: 17000 },
      });
    });

    it('sugere descrições e categorias usadas', async () => {
      await ok(
        await agent.post('/api/transactions').send({
          kind: 'expense',
          description: 'Padaria',
          amount_cents: 1500,
          occurred_on: '2026-10-03',
          account_id: ids.bradesco,
          category_id: ids.cat['Mercado'],
        }),
        201,
      );
      const suggestions = await ok(await agent.get('/api/transactions/suggestions?kind=expense'));
      expect(suggestions.map((row: { description: string }) => row.description)).toContain('Padaria');
      const frequent = await ok(await agent.get('/api/categories/frequent?kind=expense'));
      expect(frequent.map((row: { name: string }) => row.name)).toContain('Mercado');
    });

    it('exporta os lançamentos em CSV', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Pão', amount_cents: 800, occurred_on: '2026-10-04', account_id: ids.bradesco }), 201);
      const res = await agent.get('/api/export/transactions.csv');
      expect(res.status).toBe(200);
      expect(res.text.charCodeAt(0)).toBe(0xfeff);
      expect(res.text).toContain('data;descrição;valor');
      expect(res.text).toContain('Pão');
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

    it('receita marcada gera dízimo de 10% na mesma conta, no dia 30', async () => {
      const { transaction } = await ok(
        await agent.post('/api/transactions').send({ kind: 'income', description: 'Salário', amount_cents: 100000, occurred_on: '2026-10-05', account_id: ids.bradesco, counts_for_tithe: true }),
        201,
      );
      const tithe = await db.get<any>('SELECT * FROM transactions WHERE tithe_income_id = ? AND deleted_at IS NULL', [transaction.id]);
      expect(tithe).toMatchObject({
        kind: 'expense', description: 'Dízimo', amount_cents: 10000, account_id: ids.bradesco,
        due_on: '2026-10-30', occurred_on: '2026-10-30', competence_month: '2026-10', status: 'planned', paid_on: null,
      });

      const feb = await ok(
        await agent.post('/api/transactions').send({ kind: 'income', description: 'Extra', amount_cents: 10000, occurred_on: '2026-02-10', account_id: ids.bradesco, counts_for_tithe: true }),
        201,
      );
      const febTithe = await db.get<any>('SELECT due_on, amount_cents FROM transactions WHERE tithe_income_id = ? AND deleted_at IS NULL', [feb.transaction.id]);
      expect(febTithe).toMatchObject({ due_on: '2026-02-28', amount_cents: 1000 });

      const skipped = await ok(
        await agent.post('/api/transactions').send({ kind: 'income', description: 'Presente', amount_cents: 80000, occurred_on: '2026-10-06', account_id: ids.bradesco, counts_for_tithe: false }),
        201,
      );
      expect(await db.get('SELECT id FROM transactions WHERE tithe_income_id = ? AND deleted_at IS NULL', [skipped.transaction.id])).toBeUndefined();

      await ok(await agent.patch(`/api/transactions/${transaction.id}`).send({ amount_cents: 200000 }));
      expect(Number((await db.get<any>('SELECT amount_cents FROM transactions WHERE tithe_income_id = ? AND deleted_at IS NULL', [transaction.id])).amount_cents)).toBe(20000);

      const open = await db.get<any>('SELECT id FROM transactions WHERE tithe_income_id = ? AND deleted_at IS NULL', [transaction.id]);
      await ok(await agent.post(`/api/transactions/${open.id}/pay`).send({ paid_on: '2026-10-30' }));
      await ok(await agent.patch(`/api/transactions/${transaction.id}`).send({ amount_cents: 300000 }));
      expect(Number((await db.get<any>('SELECT amount_cents, paid_on FROM transactions WHERE id = ?', [open.id])).amount_cents)).toBe(20000);

      await ok(await agent.patch(`/api/transactions/${feb.transaction.id}`).send({ counts_for_tithe: 0 }));
      expect(await db.get('SELECT id FROM transactions WHERE tithe_income_id = ? AND deleted_at IS NULL', [feb.transaction.id])).toBeUndefined();

      await ok(await agent.delete(`/api/transactions/${skipped.transaction.id}`));
      const linked = await ok(
        await agent.post('/api/transactions').send({ kind: 'income', description: 'Freelance', amount_cents: 50000, occurred_on: '2026-11-02', account_id: ids.nubank, counts_for_tithe: true }),
        201,
      );
      await ok(await agent.delete(`/api/transactions/${linked.transaction.id}`));
      expect(await db.get('SELECT id FROM transactions WHERE tithe_income_id = ? AND deleted_at IS NULL', [linked.transaction.id])).toBeUndefined();
    });

    it('fixa de receita gera o dízimo de cada ocorrência nova', async () => {
      await ok(
        await agent.post('/api/recurrences').send({ kind: 'income', description: 'Salário', amount_cents: 100000, account_id: ids.bradesco, day_of_month: 15, start_month: '2026-10', counts_for_tithe: true }),
        201,
      );
      const rows = await db.all<any>("SELECT competence_month, amount_cents, due_on, status FROM transactions WHERE description = 'Dízimo' AND deleted_at IS NULL ORDER BY competence_month");
      expect(rows.map((row) => [row.competence_month, Number(row.amount_cents), row.due_on, row.status])).toEqual([
        ['2026-10', 10000, '2026-10-30', 'planned'],
        ['2026-11', 10000, '2026-11-30', 'planned'],
        ['2026-12', 10000, '2026-12-30', 'planned'],
      ]);
    });

    it('o que já estava lançado vira um dízimo por mês, com 10% da soma', async () => {
      const big = await ok(
        await agent.post('/api/transactions').send({ kind: 'income', description: 'Salário', amount_cents: 200000, occurred_on: '2026-08-05', account_id: ids.bradesco, counts_for_tithe: false }),
        201,
      );
      const small = await ok(
        await agent.post('/api/transactions').send({ kind: 'income', description: 'Extra', amount_cents: 50000, occurred_on: '2026-08-20', account_id: ids.nubank, counts_for_tithe: false }),
        201,
      );
      await db.run('UPDATE transactions SET counts_for_tithe = 1 WHERE id IN (?, ?)', [big.transaction.id, small.transaction.id]);
      await backfillTithes(db);
      const rows = await db.all<any>("SELECT description, amount_cents, account_id, due_on, status, tithe_month, for_user_id FROM transactions WHERE tithe_month IS NOT NULL AND deleted_at IS NULL");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        description: 'Dízimo', amount_cents: 25000, account_id: ids.bradesco, due_on: '2026-08-30', status: 'planned', tithe_month: '2026-08', for_user_id: null,
      });
      await backfillTithes(db);
      expect(await db.all("SELECT id FROM transactions WHERE tithe_month = '2026-08' AND deleted_at IS NULL")).toHaveLength(1);

      await ok(await agent.patch(`/api/transactions/${big.transaction.id}`).send({ amount_cents: 100000 }));
      const after = await db.all<any>("SELECT amount_cents, tithe_income_id FROM transactions WHERE deleted_at IS NULL AND (tithe_month = '2026-08' OR tithe_income_id = ?)", [big.transaction.id]);
      expect(after).toEqual([expect.objectContaining({ amount_cents: 15000, tithe_income_id: null })]);

      await ok(
        await agent.post('/api/transactions').send({ kind: 'income', description: 'Nova', amount_cents: 100000, occurred_on: '2026-08-28', account_id: ids.bradesco, counts_for_tithe: true }),
        201,
      );
      const both = await db.all<any>("SELECT amount_cents, tithe_month, tithe_income_id FROM transactions WHERE description = 'Dízimo' AND competence_month = '2026-08' AND deleted_at IS NULL ORDER BY tithe_month DESC");
      expect(both.map((row) => [Number(row.amount_cents), row.tithe_month != null])).toEqual([[15000, true], [10000, false]]);
    });

    it('cada pessoa vê o próprio dízimo do mês, na categoria Reino / Geral', async () => {
      const me = await ok(await agent.get('/api/auth/me'));
      const hers = await ok(await agent.post('/api/users').send({ name: 'Jhersyka', email: 'jhersyka@x.com', password: 'senha-segura' }), 201);
      await ok(
        await agent.post('/api/transactions').send({ kind: 'income', description: 'Salario 15', amount_cents: 454258, occurred_on: '2026-11-15', account_id: ids.bradesco, for_user_id: me.id, counts_for_tithe: false }),
        201,
      );
      await ok(
        await agent.post('/api/transactions').send({ kind: 'income', description: 'Salário 30', amount_cents: 447977, occurred_on: '2026-11-30', account_id: ids.bradesco, for_user_id: me.id, counts_for_tithe: false }),
        201,
      );
      await ok(
        await agent.post('/api/transactions').send({ kind: 'income', description: 'Salário dela', amount_cents: 300000, occurred_on: '2026-11-30', account_id: ids.nubank, for_user_id: hers.id, counts_for_tithe: false }),
        201,
      );
      await db.run("UPDATE transactions SET counts_for_tithe = 1 WHERE kind = 'income' AND competence_month = '2026-11'");
      await backfillTithes(db);
      const rows = await db.all<any>(
        `SELECT t.amount_cents, t.account_id, t.for_user_id, t.due_on, c.name AS category_name, p.name AS parent_name
           FROM transactions t
           JOIN categories c ON c.id = t.category_id
           JOIN categories p ON p.id = c.parent_id
          WHERE t.tithe_month = '2026-11' AND t.deleted_at IS NULL
          ORDER BY t.for_user_id`,
      );
      expect(rows.map((row) => [Number(row.amount_cents), row.account_id, row.for_user_id, row.due_on, row.parent_name, row.category_name])).toEqual([
        [90224, ids.bradesco, me.id, '2026-11-30', 'Reino', 'Geral'],
        [30000, ids.nubank, hers.id, '2026-11-30', 'Reino', 'Geral'],
      ]);
      const mine = await ok(await agent.get('/api/transactions?month=2026-11&kind=expense&person=me'));
      expect(mine.items.map((item: { description: string; amount_cents: number }) => [item.description, item.amount_cents])).toEqual([['Dízimo', 90224]]);
    });
  });

  describe('recorrências', () => {
    it('o histórico da fixa cobre os últimos 6 meses e separa o pago', async () => {
      const { recurrence } = await ok(
        await agent.post('/api/recurrences').send({ kind: 'expense', description: 'Internet', amount_cents: 12000, account_id: ids.bradesco, day_of_month: 10, start_month: '2026-09' }),
        201,
      );
      const occ = await db.all('SELECT id, competence_month FROM transactions WHERE recurrence_id = ? ORDER BY competence_month', [recurrence.id]);
      const september = occ.find((row) => row.competence_month === '2026-09');
      await ok(await agent.post(`/api/transactions/${september.id}/pay`).send({ paid_on: '2026-09-10' }));
      const history = await ok(await agent.get(`/api/recurrences/${recurrence.id}/history`));
      expect(history.map((row: { month: string; planned_cents: number; paid_cents: number }) => [row.month, row.planned_cents, row.paid_cents])).toEqual([
        ['2026-05', 0, 0],
        ['2026-06', 0, 0],
        ['2026-07', 0, 0],
        ['2026-08', 0, 0],
        ['2026-09', 12000, 12000],
        ['2026-10', 12000, 0],
      ]);
    });

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

    it('o dia de pagamento desta ocorrência e das seguintes muda, inclusive nas já pagas', async () => {
      const { recurrence } = await ok(
        await agent.post('/api/recurrences').send({ kind: 'income', description: 'Salário', amount_cents: 100000, account_id: ids.bradesco, day_of_month: 15, start_month: '2026-09' }),
        201,
      );
      const rows = await db.all<{ id: number; competence_month: string }>('SELECT id, competence_month FROM transactions WHERE recurrence_id = ? ORDER BY competence_month', [
        recurrence.id,
      ]);
      const september = rows.find((row) => row.competence_month === '2026-09');
      const october = rows.find((row) => row.competence_month === '2026-10');
      await ok(await agent.post(`/api/transactions/${september!.id}/pay`).send({ paid_on: '2026-09-15' }));
      await ok(await agent.post(`/api/transactions/${october!.id}/pay`).send({ paid_on: '2026-10-15' }));
      await ok(await agent.patch(`/api/recurrences/${recurrence.id}`).send({ day_of_month: 20, from_month: '2026-10', include_settled: true }));
      const after = await db.all('SELECT competence_month, due_on, paid_on FROM transactions WHERE recurrence_id = ? AND deleted_at IS NULL ORDER BY competence_month', [
        recurrence.id,
      ]);
      expect(after.map((row) => [row.competence_month, row.due_on, row.paid_on])).toEqual([
        ['2026-09', '2026-09-15', '2026-09-15'],
        ['2026-10', '2026-10-20', '2026-10-20'],
        ['2026-11', '2026-11-20', null],
        ['2026-12', '2026-12-20', null],
      ]);
    });

    it('excluir este mês da fixa e os seguintes preserva os anteriores e para de gerar', async () => {
      const { recurrence } = await ok(
        await agent.post('/api/recurrences').send({ kind: 'expense', description: 'Academia', amount_cents: 9000, account_id: ids.bradesco, day_of_month: 5, start_month: '2026-09' }),
        201,
      );
      const removed = await ok(await agent.post(`/api/recurrences/${recurrence.id}/delete-from`).send({ from_month: '2026-10' }));
      expect(removed.deleted).toBeGreaterThan(0);
      expect(removed.recurrence.end_month).toBe('2026-09');
      await agent.get('/api/transactions?month=2027-01&kind=expense');
      const rows = await db.all('SELECT competence_month FROM transactions WHERE recurrence_id = ? AND deleted_at IS NULL ORDER BY competence_month', [recurrence.id]);
      expect(rows.map((row) => row.competence_month)).toEqual(['2026-09']);
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
      expect(loose.card_name).toBe('Ultra · cartão');
      expect(loose.items[0]).toMatchObject({ name: 'Notebook · 6x', card_name: 'Ultra · cartão' });
      expect(card.available_cents).toBe(1410000 - 270000);
    });

    it('contrato é um parcelamento em conta marcado: resumo, marcar e desmarcar, e cartão não pode', async () => {
      const { plan } = await ok(
        await agent.post('/api/installments').send({
          description: 'Carro', total_cents: 60000, installments: 6, account_id: ids.bradesco, purchased_on: '2026-10-05', first_paid: true,
          is_contract: true, lender: 'Banco X', contracted_cents: 50000, monthly_rate_bp: 149,
        }),
        201,
      );
      expect(plan).toMatchObject({ is_contract: 1, lender: 'Banco X', contracted_cents: 50000, monthly_rate_bp: 149 });
      expect((await agent.post('/api/installments').send({ description: 'TV', total_cents: 30000, installments: 3, card_id: ids.ultra, is_contract: true })).status).toBe(400);

      const detail = await ok(await agent.get(`/api/installments/${plan.id}`));
      expect(detail).toMatchObject({
        lender: 'Banco X',
        contracted_cents: 50000,
        monthly_rate_bp: 149,
        account_name: 'Bradesco',
      });
      expect(detail.items[0]).toMatchObject({
        account_name: 'Bradesco',
        plan_installments: 6,
        display_status: 'paid',
        status_label: 'Pago',
        paid_on: '2026-10-05',
      });

      const view = await ok(await agent.get('/api/installments/contracts'));
      expect(view.contracts).toHaveLength(1);
      expect(view.contracts[0]).toMatchObject({
        description: 'Carro', lender: 'Banco X', installments: 6, paid_count: 1, paid_cents: 10000, remaining_cents: 50000, month_cents: 10000,
        saved_cents: 0, next: { installment_no: 2, due_on: '2026-11-05', amount_cents: 10000, overdue: false }, ends_on: '2027-03-05',
      });
      expect(view).toMatchObject({ remaining_cents: 50000, month_cents: 10000 });
      // Trocar a categoria do contrato muda as prestações em aberto; a já paga fica como estava.
      expect((await agent.patch(`/api/installments/${plan.id}`).send({ category_id: ids.cat['Salário'] })).status).toBe(400);
      await ok(await agent.patch(`/api/installments/${plan.id}`).send({ category_id: ids.cat['Mercado'] }));
      expect((await ok(await agent.get('/api/installments/contracts'))).contracts[0]).toMatchObject({ category_id: ids.cat['Mercado'], category_name: 'Mercado' });
      const recat = await ok(await agent.get(`/api/installments/${plan.id}`));
      expect(recat.items[0].category_id).toBeNull();
      expect(recat.items.slice(1).every((t: any) => t.category_id === ids.cat['Mercado'])).toBe(true);
      // A prestação continua sendo uma despesa normal do mês: aparece uma vez no Extrato.
      const month = await ok(await agent.get('/api/transactions?month=2026-10&kind=expense&person=all'));
      expect(month.items.filter((t: any) => t.description === 'Carro')).toHaveLength(1);
      expect(month.items.find((t: any) => t.description === 'Carro').recurrence_class).toBe('contract');
      expect(month.summary.recurrence).toMatchObject({ contract: 10000, installment: 0 });
      const dashboard = await ok(await agent.get('/api/dashboard?month=2026-10&person=all'));
      expect(dashboard.recurrence.find((item: any) => item.key === 'contract')).toMatchObject({ name: 'Contratos', total_cents: 10000 });
      expect(dashboard.recurrence.find((item: any) => item.key === 'installment').total_cents).toBe(0);

      const other = (await ok(await agent.post('/api/installments').send({ description: 'Fies', total_cents: 9000, installments: 3, account_id: ids.bradesco, purchased_on: '2026-10-20' }), 201)).plan;
      await ok(await agent.patch(`/api/installments/${other.id}`).send({ is_contract: true, lender: 'Fies' }));
      expect((await ok(await agent.get('/api/installments/contracts'))).contracts.map((c: any) => c.description)).toEqual(['Carro', 'Fies']);
      await ok(await agent.patch(`/api/installments/${plan.id}`).send({ is_contract: false }));
      expect((await ok(await agent.get('/api/installments/contracts'))).contracts.map((c: any) => c.description)).toEqual(['Fies']);

      const cardPlan = (await ok(await agent.post('/api/installments').send({ description: 'Sofá', total_cents: 30000, installments: 3, card_id: ids.ultra, purchased_on: '2026-10-01' }), 201)).plan;
      expect((await agent.patch(`/api/installments/${cardPlan.id}`).send({ is_contract: true })).status).toBe(400);
    });

    it('contrato dividido: uma linha por pessoa em cada prestação, Eu vê só a sua parte, e a divisão muda só o que está em aberto', async () => {
      const me = await ok(await agent.get('/api/auth/me'));
      await ok(await agent.post('/api/users').send({ name: 'Jhersyka', email: 'j@x.com', password: 'senha-segura' }), 201);
      const hers = (await ok(await agent.get('/api/users'))).find((u: any) => u.email === 'j@x.com');
      const shares = [{ user_id: me.id, bp: 6000 }, { user_id: hers.id, bp: 4000 }];
      const { plan } = await ok(
        await agent.post('/api/installments').send({
          description: 'Casa', total_cents: 300000, installments: 3, account_id: ids.bradesco, purchased_on: '2026-10-05', first_paid: true,
          is_contract: true, contract_type: 'house', shares,
        }),
        201,
      );
      expect(plan).toMatchObject({ contract_type: 'house', shares, active_count: 3, settled_count: 1 });
      const lines = (await ok(await agent.get(`/api/installments/${plan.id}`))).items.filter((t: any) => !t.deleted_at);
      expect(lines).toHaveLength(6);
      expect(lines.filter((t: any) => t.installment_no === 1).map((t: any) => [t.for_user_id, t.amount_cents])).toEqual([[me.id, 60000], [hers.id, 40000]]);
      expect(lines.every((t: any) => t.account_id === ids.bradesco)).toBe(true);

      const mine = await ok(await agent.get('/api/transactions?month=2026-10&kind=expense&person=me'));
      expect(mine.items.filter((t: any) => t.description === 'Casa').map((t: any) => t.amount_cents)).toEqual([60000]);
      const both = await ok(await agent.get('/api/transactions?month=2026-10&kind=expense&person=all'));
      expect(both.items.filter((t: any) => t.description === 'Casa').reduce((a: number, t: any) => a + t.amount_cents, 0)).toBe(100000);

      const card = (await ok(await agent.get('/api/installments/contracts'))).contracts.find((c: any) => c.description === 'Casa');
      expect(card).toMatchObject({ contract_type: 'house', shares, paid_count: 1, active_count: 3, months_left: 2, remaining_cents: 200000, next: { installment_no: 2, amount_cents: 100000 } });

      // Mudar a parcela 2 em diante: o valor novo se reparte pela divisão.
      await ok(await agent.post(`/api/installments/${plan.id}/apply-from`).send({ from_installment: 2, amount_cents: 120000 }));
      // Meio a meio daqui pra frente: a parcela 1, já paga, não muda.
      await ok(await agent.patch(`/api/installments/${plan.id}`).send({ shares: [{ user_id: me.id, bp: 5000 }, { user_id: hers.id, bp: 5000 }] }));
      let after = (await ok(await agent.get(`/api/installments/${plan.id}`))).items.filter((t: any) => !t.deleted_at);
      expect(after.filter((t: any) => t.installment_no === 1).map((t: any) => t.amount_cents)).toEqual([60000, 40000]);
      expect(after.filter((t: any) => t.installment_no === 2).map((t: any) => t.amount_cents)).toEqual([60000, 60000]);
      // Volta a ser só da casa: uma linha por parcela em aberto, com o total.
      await ok(await agent.patch(`/api/installments/${plan.id}`).send({ shares: null, for_user_id: null }));
      after = (await ok(await agent.get(`/api/installments/${plan.id}`))).items.filter((t: any) => !t.deleted_at);
      expect(after.filter((t: any) => t.installment_no === 3).map((t: any) => [t.for_user_id, t.amount_cents])).toEqual([[null, 120000]]);

      // Editar "esta e as seguintes" na linha de uma pessoa muda só a parte dela.
      const moto = (await ok(await agent.post('/api/installments').send({ description: 'Moto', total_cents: 60000, installments: 3, account_id: ids.bradesco, purchased_on: '2026-10-20', is_contract: true, shares }), 201)).plan;
      const motoLines = (await ok(await agent.get(`/api/installments/${moto.id}`))).items;
      const herLine = motoLines.find((t: any) => t.installment_no === 2 && t.for_user_id === hers.id);
      await ok(await agent.post(`/api/installments/${moto.id}/apply-from`).send({ from_installment: 2, amount_cents: 5000, line_tx_id: herLine.id }));
      const motoAfter = (await ok(await agent.get(`/api/installments/${moto.id}`))).items.filter((t: any) => !t.deleted_at && t.installment_no >= 2);
      expect(motoAfter.map((t: any) => [t.installment_no, t.for_user_id, t.amount_cents])).toEqual([
        [2, me.id, 12000], [2, hers.id, 5000], [3, me.id, 12000], [3, hers.id, 5000],
      ]);

      expect((await agent.post('/api/installments').send({ description: 'X', total_cents: 300, installments: 3, account_id: ids.bradesco, shares: [{ user_id: me.id, bp: 5000 }, { user_id: hers.id, bp: 4000 }] })).status).toBe(400);
      expect((await agent.post('/api/installments').send({ description: 'X', total_cents: 300, installments: 3, card_id: ids.ultra, shares })).status).toBe(400);
    });

    it('prestação dividida sai da conta de cada pessoa, e mudar a conta só mexe no que está em aberto', async () => {
      const me = await ok(await agent.get('/api/auth/me'));
      await ok(await agent.post('/api/users').send({ name: 'Jhersyka', email: 'j2@x.com', password: 'senha-segura' }), 201);
      const hers = (await ok(await agent.get('/api/users'))).find((u: any) => u.email === 'j2@x.com');
      const shares = [
        { user_id: me.id, bp: 5000, account_id: ids.bradesco },
        { user_id: hers.id, bp: 5000, account_id: ids.nubank },
      ];
      const { plan } = await ok(
        await agent.post('/api/installments').send({
          description: 'Apto', total_cents: 100000, installments: 2, account_id: ids.bradesco, purchased_on: '2026-10-05', first_paid: true,
          is_contract: true, shares,
        }),
        201,
      );
      const lines = (await ok(await agent.get(`/api/installments/${plan.id}`))).items.filter((t: any) => !t.deleted_at);
      expect(lines.filter((t: any) => t.installment_no === 1).map((t: any) => [t.for_user_id, t.account_id, t.amount_cents])).toEqual([
        [me.id, ids.bradesco, 25000],
        [hers.id, ids.nubank, 25000],
      ]);
      expect(lines.filter((t: any) => t.installment_no === 2).map((t: any) => [t.account_id, t.paid_on])).toEqual([
        [ids.bradesco, null],
        [ids.nubank, null],
      ]);
      // A prestação paga já saiu: cada conta cai só a metade, não a prestação inteira.
      expect((await balanceOf(ids.bradesco)).current_balance_cents).toBe(450000 - 25000);
      expect((await balanceOf(ids.nubank)).current_balance_cents).toBe(-25000);
      // A prestação seguinte, ainda prevista, continua na conta de cada um.
      expect((await balanceOf(ids.bradesco, '2026-11')).forecast_balance_cents).toBe(450000 - 50000);
      expect((await balanceOf(ids.nubank, '2026-11')).forecast_balance_cents).toBe(-50000);
      const card = (await ok(await agent.get('/api/installments/contracts'))).contracts.find((c: any) => c.description === 'Apto');
      expect(card.shares).toEqual(shares);
      expect(card.next.amount_cents).toBe(50000);
      // No Eu, o mesmo contrato mostra só a parte de quem está logado; a divisão continua inteira.
      const mineView = await ok(await agent.get('/api/installments/contracts?person=me'));
      const mine = mineView.contracts.find((c: any) => c.description === 'Apto');
      expect(mine.shares).toEqual(shares);
      expect(mine.next.amount_cents).toBe(25000);
      expect(mine.remaining_cents).toBe(card.remaining_cents / 2);
      expect(mine.saved_cents).toBeNull();
      expect(mineView.remaining_cents).toBe(mineView.contracts.reduce((sum: number, c: any) => sum + c.remaining_cents, 0));

      await ok(await agent.patch(`/api/installments/${plan.id}`).send({
        shares: [
          { user_id: me.id, bp: 5000, account_id: ids.bradesco },
          { user_id: hers.id, bp: 5000, account_id: ids.bradesco },
        ],
      }));
      const after = (await ok(await agent.get(`/api/installments/${plan.id}`))).items.filter((t: any) => !t.deleted_at);
      expect(after.find((t: any) => t.installment_no === 1 && t.for_user_id === hers.id).account_id).toBe(ids.nubank);
      expect(after.find((t: any) => t.installment_no === 2 && t.for_user_id === hers.id).account_id).toBe(ids.bradesco);
    });

    it('uma pessoa quita a prestação dividida inteira com desconto, sem assumir a parte da outra, e pode desfazer', async () => {
      const me = await ok(await agent.get('/api/auth/me'));
      await ok(await agent.post('/api/users').send({ name: 'Jhersyka', email: 'quita@x.com', password: 'senha-segura' }), 201);
      const hers = (await ok(await agent.get('/api/users'))).find((u: any) => u.email === 'quita@x.com');
      const { plan } = await ok(
        await agent.post('/api/installments').send({
          description: 'Carro dividido',
          total_cents: 20003,
          installments: 2,
          account_id: ids.bradesco,
          purchased_on: '2026-10-20',
          is_contract: true,
          shares: [
            { user_id: me.id, bp: 5000, account_id: ids.bradesco },
            { user_id: hers.id, bp: 5000, account_id: ids.nubank },
          ],
        }),
        201,
      );
      const paid = await ok(
        await agent.post(`/api/installments/${plan.id}/settle-installment`).send({
          installment_no: 2,
          amount_cents: 9001,
          paid_on: '2026-10-08',
          payer_user_id: me.id,
          account_id: ids.bradesco,
        }),
      );
      expect(paid).toMatchObject({ installment_no: 2, expected_cents: 10001, paid_cents: 9001, lines: 2 });

      let detail = await ok(await agent.get(`/api/installments/${plan.id}`));
      let lines = detail.items.filter((t: any) => t.installment_no === 2);
      expect(lines.map((t: any) => [t.for_user_id, t.split_bp, t.amount_cents])).toEqual([
        [me.id, 5000, 4501],
        [hers.id, 5000, 4500],
      ]);
      expect(lines.every((t: any) => t.account_id === ids.bradesco && t.paid_by_user_id === me.id && t.paid_by_user_name === 'Diego')).toBe(true);
      expect(lines.map((t: any) => [t.settlement_expected_cents, t.settlement_previous_account_id, t.settlement_previous_account_name])).toEqual([
        [5001, ids.bradesco, 'Bradesco'],
        [5000, ids.nubank, 'Nubank'],
      ]);
      expect((await balanceOf(ids.bradesco)).current_balance_cents).toBe(450000 - 9001);
      expect((await balanceOf(ids.nubank)).current_balance_cents).toBe(0);

      // O valor pago não é reescrito e uma quitação conjunta não é desfeita pela metade.
      await ok(await agent.post(`/api/installments/${plan.id}/apply-from`).send({ from_installment: 2, amount_cents: 8000 }));
      detail = await ok(await agent.get(`/api/installments/${plan.id}`));
      lines = detail.items.filter((t: any) => t.installment_no === 2);
      expect(lines.map((t: any) => t.amount_cents)).toEqual([4501, 4500]);
      expect((await agent.post(`/api/transactions/${lines[0].id}/unpay`).send({})).status).toBe(400);

      const other = await register('outra-quita@x.com', 'Outra casa');
      expect((await other.post(`/api/installments/${plan.id}/settle-installment`).send({
        installment_no: 1, amount_cents: 10002, payer_user_id: me.id, account_id: ids.bradesco,
      })).status).toBe(404);

      const undone = await ok(await agent.post(`/api/installments/${plan.id}/unsettle-installment`).send({ settlement_uuid: paid.settlement_uuid }));
      expect(undone.restored).toBe(2);
      detail = await ok(await agent.get(`/api/installments/${plan.id}`));
      lines = detail.items.filter((t: any) => t.installment_no === 2);
      expect(lines.map((t: any) => [t.for_user_id, t.amount_cents, t.account_id, t.paid_on, t.paid_by_user_id])).toEqual([
        [me.id, 5001, ids.bradesco, null, null],
        [hers.id, 5000, ids.nubank, null, null],
      ]);
      expect((await balanceOf(ids.bradesco)).current_balance_cents).toBe(450000);
      expect((await balanceOf(ids.nubank)).current_balance_cents).toBe(0);
    });

    it('quitar o restante preserva a parte já paga e registra quem pagou a parte aberta', async () => {
      const me = await ok(await agent.get('/api/auth/me'));
      await ok(await agent.post('/api/users').send({ name: 'Jhersyka', email: 'restante@x.com', password: 'senha-segura' }), 201);
      const hers = (await ok(await agent.get('/api/users'))).find((u: any) => u.email === 'restante@x.com');
      const { plan } = await ok(
        await agent.post('/api/installments').send({
          description: 'Apto restante', total_cents: 20000, installments: 2, account_id: ids.bradesco, purchased_on: '2026-10-20', is_contract: true,
          shares: [
            { user_id: me.id, bp: 5000, account_id: ids.bradesco },
            { user_id: hers.id, bp: 5000, account_id: ids.nubank },
          ],
        }),
        201,
      );
      const before = (await ok(await agent.get(`/api/installments/${plan.id}`))).items;
      const mine = before.find((t: any) => t.installment_no === 1 && t.for_user_id === me.id);
      await ok(await agent.post(`/api/transactions/${mine.id}/pay`).send({ paid_on: '2026-10-08' }));
      let card = (await ok(await agent.get('/api/installments/contracts'))).contracts.find((item: any) => item.id === plan.id);
      expect(card).toMatchObject({ paid_count: 0, paid_cents: 5000, remaining_cents: 15000, next: { installment_no: 1, amount_cents: 10000 } });
      const settled = await ok(await agent.post(`/api/installments/${plan.id}/settle-installment`).send({
        installment_no: 1, amount_cents: 4000, payer_user_id: me.id, account_id: ids.bradesco,
      }));
      expect(settled).toMatchObject({ expected_cents: 5000, paid_cents: 4000, lines: 1 });
      const after = (await ok(await agent.get(`/api/installments/${plan.id}`))).items.filter((t: any) => t.installment_no === 1);
      expect(after.find((t: any) => t.for_user_id === me.id)).toMatchObject({ amount_cents: 5000, paid_by_user_id: null });
      expect(after.find((t: any) => t.for_user_id === hers.id)).toMatchObject({
        amount_cents: 4000, account_id: ids.bradesco, paid_by_user_id: me.id, settlement_expected_cents: 5000,
      });
      card = (await ok(await agent.get('/api/installments/contracts'))).contracts.find((item: any) => item.id === plan.id);
      expect(card).toMatchObject({ paid_count: 1, paid_cents: 9000, remaining_cents: 10000, saved_cents: 1000 });
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

    it('apaga a parcela escolhida e as seguintes, e tira o plano quando não sobra nenhuma', async () => {
      const { plan } = await ok(
        await agent.post('/api/installments').send({ description: 'Geladeira', total_cents: 30000, installments: 3, account_id: ids.bradesco, purchased_on: '2026-10-01' }),
        201,
      );
      const partial = await ok(await agent.post(`/api/installments/${plan.id}/delete-from`).send({ from_installment: 2 }));
      expect(partial.deleted).toBe(2);
      expect(partial.plan.deleted_at).toBeNull();
      expect(partial.plan.active_count).toBe(1);
      const left = await db.all('SELECT installment_no, deleted_at FROM transactions WHERE plan_id = ? ORDER BY installment_no', [plan.id]);
      expect(left.map((r) => [r.installment_no, r.deleted_at == null])).toEqual([
        [1, true],
        [2, false],
        [3, false],
      ]);

      const gone = await ok(await agent.post(`/api/installments/${plan.id}/delete-from`).send({ from_installment: 1 }));
      expect(gone.deleted).toBe(1);
      expect(gone.plan.deleted_at).toBeTruthy();
      const list = await ok(await agent.get('/api/installments'));
      expect(list.find((p: { id: number }) => p.id === plan.id)).toBeUndefined();
    });

    it('aplica valor e dia nesta parcela e nas seguintes que ainda não foram pagas', async () => {
      const { plan } = await ok(
        await agent.post('/api/installments').send({ description: 'Sofá', total_cents: 30000, installments: 3, account_id: ids.bradesco, purchased_on: '2026-10-01', first_paid: true }),
        201,
      );
      const before = await db.all('SELECT id, installment_no FROM transactions WHERE plan_id = ? ORDER BY installment_no', [plan.id]);
      const first = await ok(await agent.get(`/api/transactions/${before[0].id}`));
      const last = await ok(await agent.get(`/api/transactions/${before[2].id}`));
      expect(first.has_following).toBe(1);
      expect(last.has_following).toBe(0);

      await ok(await agent.post(`/api/installments/${plan.id}/apply-from`).send({ from_installment: 1, amount_cents: 8000, day_of_month: 15 }));
      const mid = await db.get('SELECT id FROM transactions WHERE plan_id = ? AND installment_no = 2', [plan.id]);
      await ok(await agent.post(`/api/transactions/${mid.id}/pay`).send({ paid_on: '2026-11-15' }));
      await ok(await agent.post(`/api/installments/${plan.id}/apply-from`).send({ from_installment: 1, amount_cents: 7000 }));

      const rows = await db.all('SELECT installment_no, amount_cents, due_on FROM transactions WHERE plan_id = ? ORDER BY installment_no', [plan.id]);
      expect(rows.map((r) => [r.installment_no, Number(r.amount_cents), r.due_on])).toEqual([
        [1, 10000, '2026-10-15'],
        [2, 8000, '2026-11-15'],
        [3, 7000, '2026-12-15'],
      ]);

      await ok(await agent.post(`/api/installments/${plan.id}/apply-from`).send({ from_installment: 1, day_of_month: 20, include_settled: true }));
      const moved = await db.all('SELECT installment_no, amount_cents, due_on, paid_on FROM transactions WHERE plan_id = ? ORDER BY installment_no', [plan.id]);
      expect(moved.map((r) => [r.installment_no, Number(r.amount_cents), r.due_on, r.paid_on])).toEqual([
        [1, 10000, '2026-10-20', '2026-10-20'],
        [2, 8000, '2026-11-20', '2026-11-20'],
        [3, 7000, '2026-12-20', null],
      ]);
    });

    it('no cartão, o valor segue para as faturas que ainda não passaram e a data não muda', async () => {
      const { plan } = await ok(
        await agent.post('/api/installments').send({ description: 'Notebook', total_cents: 30000, installments: 3, card_id: ids.ultra, purchased_on: '2026-06-08' }),
        201,
      );
      const detail = await ok(await agent.get(`/api/installments/${plan.id}`));
      expect(detail.card_name).toBe('Ultra');
      expect(detail.items[0]).toMatchObject({
        card_name: 'Ultra',
        invoice_due_on: '2026-08-06',
        invoice_paid: 0,
        display_status: 'overdue',
        status_label: 'Atrasado',
      });
      expect((await agent.post(`/api/installments/${plan.id}/apply-from`).send({ from_installment: 1, day_of_month: 10 })).status).toBe(400);
      await ok(await agent.post(`/api/installments/${plan.id}/apply-from`).send({ from_installment: 1, amount_cents: 9000 }));
      const rows = await db.all('SELECT installment_no, amount_cents, competence_month FROM transactions WHERE plan_id = ? ORDER BY installment_no', [plan.id]);
      expect(rows.map((r) => [r.installment_no, Number(r.amount_cents), r.competence_month])).toEqual([
        [1, 9000, '2026-08'],
        [2, 10000, '2026-09'],
        [3, 9000, '2026-10'],
      ]);
    });

    it('nome e quantidade do parcelamento valem para todas as parcelas', async () => {
      const { plan } = await ok(
        await agent.post('/api/installments').send({
          description: 'Geladeira', total_cents: 10000, installments: 3, account_id: ids.bradesco, purchased_on: '2026-10-01', first_paid: true,
        }),
        201,
      );
      const renamed = await ok(await agent.post(`/api/installments/${plan.id}/reshape`).send({ description: 'Geladeira nova' }));
      const names = await db.all('SELECT description, paid_on FROM transactions WHERE plan_id = ? AND deleted_at IS NULL ORDER BY installment_no', [plan.id]);
      expect(names.every((row) => row.description === 'Geladeira nova')).toBe(true);
      expect(names[0].paid_on).toBeTruthy();
      expect(renamed.description).toBe('Geladeira nova');
      expect(renamed.installments).toBe(3);

      const grown = await ok(await agent.post(`/api/installments/${plan.id}/reshape`).send({ installments: 4 }));
      const rows = await db.all(
        'SELECT installment_no, amount_cents, due_on, paid_on, description FROM transactions WHERE plan_id = ? AND deleted_at IS NULL ORDER BY installment_no',
        [plan.id],
      );
      expect(rows.map((row) => [row.installment_no, Number(row.amount_cents), row.due_on, row.paid_on != null, row.description])).toEqual([
        [1, 3334, '2026-10-01', true, 'Geladeira nova'],
        [2, 3333, '2026-11-01', false, 'Geladeira nova'],
        [3, 3333, '2026-12-01', false, 'Geladeira nova'],
        [4, 3333, '2027-01-01', false, 'Geladeira nova'],
      ]);
      expect(grown.total_cents).toBe(13333);
      expect(grown.installments).toBe(4);

      const third = await db.get<{ id: number }>('SELECT id FROM transactions WHERE plan_id = ? AND installment_no = 3', [plan.id]);
      await ok(await agent.post(`/api/transactions/${third.id}/pay`).send({ paid_on: '2026-12-01' }));
      const blocked = await agent.post(`/api/installments/${plan.id}/reshape`).send({ installments: 2 });
      expect(blocked.status).toBe(400);
      expect(blocked.body.error).toMatch(/parcela 3 já foi paga/);

      await ok(await agent.post(`/api/installments/${plan.id}/reshape`).send({ installments: 3 }));
      const left = await db.all('SELECT installment_no FROM transactions WHERE plan_id = ? AND deleted_at IS NULL ORDER BY installment_no', [plan.id]);
      expect(left.map((row) => row.installment_no)).toEqual([1, 2, 3]);
      const shrunk = await ok(await agent.get(`/api/installments/${plan.id}`));
      expect(shrunk.total_cents).toBe(10000);
      expect(shrunk.installments).toBe(3);
    });

    it('parcela nova no cartão cai na fatura seguinte e a dividida copia as duas partes', async () => {
      const me = await ok(await agent.get('/api/auth/me'));
      await ok(await agent.post('/api/users').send({ name: 'Jhersyka', email: 'reshape@x.com', password: 'senha-segura' }), 201);
      const hers = (await ok(await agent.get('/api/users'))).find((u: any) => u.email === 'reshape@x.com');
      const { plan } = await ok(
        await agent.post('/api/installments').send({
          description: 'Casa', total_cents: 10000, installments: 2, account_id: ids.bradesco, purchased_on: '2026-10-05',
          shares: [{ user_id: me.id, bp: 6000, account_id: ids.bradesco }, { user_id: hers.id, bp: 4000, account_id: ids.nubank }],
        }),
        201,
      );
      await ok(await agent.post(`/api/installments/${plan.id}/reshape`).send({ description: 'Casa nova', installments: 3 }));
      const lines = await db.all(
        'SELECT installment_no, for_user_id, amount_cents, account_id, description FROM transactions WHERE plan_id = ? AND deleted_at IS NULL ORDER BY installment_no, for_user_id',
        [plan.id],
      );
      expect(lines.map((row) => [row.installment_no, row.for_user_id, Number(row.amount_cents), row.account_id, row.description])).toEqual([
        [1, me.id, 3000, ids.bradesco, 'Casa nova'],
        [1, hers.id, 2000, ids.nubank, 'Casa nova'],
        [2, me.id, 3000, ids.bradesco, 'Casa nova'],
        [2, hers.id, 2000, ids.nubank, 'Casa nova'],
        [3, me.id, 3000, ids.bradesco, 'Casa nova'],
        [3, hers.id, 2000, ids.nubank, 'Casa nova'],
      ]);

      const cardPlan = (await ok(
        await agent.post('/api/installments').send({ description: 'Notebook', total_cents: 20000, installments: 2, card_id: ids.ultra, purchased_on: '2026-10-08' }),
        201,
      )).plan;
      await ok(await agent.post(`/api/installments/${cardPlan.id}/reshape`).send({ installments: 3 }));
      const months = await db.all('SELECT installment_no, competence_month, amount_cents FROM transactions WHERE plan_id = ? AND deleted_at IS NULL ORDER BY installment_no', [cardPlan.id]);
      expect(months.map((row) => [row.installment_no, row.competence_month, Number(row.amount_cents)])).toEqual([
        [1, '2026-12', 10000],
        [2, '2027-01', 10000],
        [3, '2027-02', 10000],
      ]);
      const old = (await ok(
        await agent.post('/api/installments').send({ description: 'Antigo', total_cents: 30000, installments: 3, card_id: ids.ultra, purchased_on: '2026-06-08' }),
        201,
      )).plan;
      const closed = await agent.post(`/api/installments/${old.id}/reshape`).send({ installments: 2 });
      expect(closed.status).toBe(400);
      expect(closed.body.error).toMatch(/fatura fechada/);
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

  describe('excluir cartão', () => {
    it('apaga o cartão e tudo dele: compras, parcelas, fixas e pagamentos, sem deixar fatura em Lançamentos nem nos totais', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Mercado', amount_cents: 50000, occurred_on: '2026-09-05', card_id: ids.ultra }), 201);
      await ok(await agent.post('/api/recurrences').send({ kind: 'expense', amount_cents: 3000, description: 'Fixa Ultra', card_id: ids.ultra, day_of_month: 10, start_month: '2026-10' }), 201);
      const detail = await ok(await agent.get(`/api/cards/${ids.ultra}/invoices/2026-10`));
      await ok(await agent.post(`/api/invoices/${detail.id}/payments`).send({ amount_cents: 10000, account_id: ids.bradesco }), 201);
      const before = await ok(await agent.get('/api/dashboard?month=2026-10&person=all'));
      const saldoAntes = (await balanceOf(ids.bradesco, '2026-10')).current_balance_cents;
      expect(before.expense.total_cents).toBeGreaterThan(0);

      const impact = await ok(await agent.get(`/api/cards/${ids.ultra}/impact`));
      expect(impact).toMatchObject({ recurrences: 1, invoice_payments: 1 });
      expect(impact.transactions).toBeGreaterThanOrEqual(2);

      const res = await ok(await agent.delete(`/api/cards/${ids.ultra}`));
      expect(res).toMatchObject({ deleted: true });
      expect(res.removed).toEqual(impact);

      expect((await ok(await agent.get('/api/cards'))).map((c: any) => c.id)).not.toContain(ids.ultra);
      expect((await ok(await agent.get('/api/cards?archived=1'))).map((c: any) => c.id)).not.toContain(ids.ultra);
      for (const month of ['2026-09', '2026-10', '2026-11', '2027-01']) {
        const lanc = await ok(await agent.get(`/api/transactions?month=${month}&kind=expense&person=all`));
        expect(lanc.invoices.some((i: any) => i.card_name === 'Ultra')).toBe(false);
        expect(lanc.items.some((t: any) => t.card_id === ids.ultra)).toBe(false);
        const dash = await ok(await agent.get(`/api/dashboard?month=${month}&person=all`));
        expect(dash.expense.total_cents).toBe(0);
      }
      expect((await ok(await agent.get('/api/recurrences'))).some((r: any) => r.description === 'Fixa Ultra')).toBe(false);
      // o pagamento da fatura sai junto, então o dinheiro volta para a conta
      expect((await balanceOf(ids.bradesco, '2026-10')).current_balance_cents).toBe(saldoAntes + 10000);
    });

    it('só o administrador vê o impacto e exclui; arquivar continua guardando o histórico', async () => {
      await ok(await agent.post('/api/users').send({ name: 'Jhersyka', email: 'j@x.com', password: 'senha-segura' }), 201);
      const member = request.agent(app);
      await ok(await member.post('/api/auth/login').send({ email: 'j@x.com', password: 'senha-segura' }));
      expect((await member.get(`/api/cards/${ids.ultra}/impact`)).status).toBe(403);
      expect((await member.delete(`/api/cards/${ids.ultra}`)).status).toBe(403);
      expect((await member.get(`/api/accounts/${ids.bradesco}/impact`)).status).toBe(403);

      // arquivar só com tudo pago: fatura em aberto bloqueia, para não sobrar dívida sem como pagar
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 1000, occurred_on: '2026-09-05', card_id: ids.ultra }), 201);
      const bloqueado = await agent.patch(`/api/cards/${ids.ultra}`).send({ archived: 1 });
      expect(bloqueado.status).toBe(400);
      expect(bloqueado.body.error).toMatch(/a pagar em faturas/);
      expect((await ok(await agent.get('/api/cards'))).some((c: any) => c.id === ids.ultra)).toBe(true);
      const fatura = await ok(await agent.get(`/api/cards/${ids.ultra}/invoices/2026-10`));
      await ok(await agent.post(`/api/invoices/${fatura.id}/payments`).send({ amount_cents: fatura.remaining_cents, account_id: ids.bradesco }), 201);
      await ok(await agent.patch(`/api/cards/${ids.ultra}`).send({ archived: 1 }));
      expect((await ok(await agent.get('/api/cards?archived=1'))).some((c: any) => c.id === ids.ultra)).toBe(true);
    });
  });

  describe('cartões e faturas', () => {
    it('no Eu cada um vê só o próprio cartão; no Nós aparecem os dois', async () => {
      await ok(await agent.post('/api/users').send({ name: 'Jhersyka', email: 'jhersyka@x.com', password: 'senha-segura' }), 201);
      const users = await ok(await agent.get('/api/users'));
      const hers = users.find((u: { email: string }) => u.email === 'jhersyka@x.com');
      const member = request.agent(app);
      await ok(await member.post('/api/auth/login').send({ email: 'jhersyka@x.com', password: 'senha-segura' }));
      const nubank = await ok(await member.post('/api/cards').send({ name: 'Nubank', closing_day: 3, due_day: 10, limit_cents: 100000, for_user_id: hers.id }), 201);

      const herList = await ok(await member.get('/api/cards?person=me'));
      expect(herList.map((c: { name: string }) => c.name)).toEqual(['Nubank']);
      const hisList = await ok(await agent.get('/api/cards?person=me'));
      expect(hisList.map((c: { name: string }) => c.name)).toEqual(['Ultra']);
      const both = await ok(await member.get('/api/cards?person=all'));
      expect(both.map((c: { name: string }) => c.name).sort()).toEqual(['Nubank', 'Ultra']);
      expect((await member.get(`/api/cards/${ids.ultra}/invoices/2026-10?person=me`)).status).toBe(404);
      expect((await agent.get(`/api/cards/${nubank.id}/invoices/2026-10?person=me`)).status).toBe(404);
      expect((await member.post('/api/cards').send({ name: 'Casa', closing_day: 1, due_day: 10, for_user_id: null })).status).toBe(400);
    });

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

    it('reajustar fatura mexe só no que não é parcela, para cima e para baixo', async () => {
      await ok(await agent.post('/api/installments').send({ description: 'Notebook', total_cents: 30000, installments: 3, card_id: ids.ultra, purchased_on: '2026-09-05' }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 50000, occurred_on: '2026-09-05', card_id: ids.ultra }), 201);
      const inv = await ok(await agent.get(`/api/cards/${ids.ultra}/invoices/2026-10`));
      const parcel = inv.transactions.find((t: any) => t.plan_id);
      expect(parcel.amount_cents).toBe(10000);
      const after = await ok(await agent.post(`/api/invoices/${inv.id}/adjust`).send({ loose_cents: 52345 }));
      expect(after.total_cents).toBe(62345);
      expect(after.installment_cents).toBe(10000);
      expect(after.loose_cents).toBe(52345);
      expect(after.adjustment_cents).toBe(2345);
      expect(after.transactions.find((t: any) => t.plan_id).amount_cents).toBe(10000);
      expect(after.transactions.find((t: any) => t.description === 'Ajuste de fatura')).toBeUndefined();
      const down = await ok(await agent.post(`/api/invoices/${inv.id}/adjust`).send({ loose_cents: 100 }));
      expect(down.total_cents).toBe(10100);
      expect(down.transactions.find((t: any) => t.plan_id).amount_cents).toBe(10000);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Ajuste de fatura', amount_cents: 500, occurred_on: '2026-09-05', card_id: ids.ultra }), 201);
      const withLegacy = await ok(await agent.get(`/api/cards/${ids.ultra}/invoices/2026-10`));
      const kept = await ok(await agent.post(`/api/invoices/${inv.id}/adjust`).send({ loose_cents: withLegacy.loose_cents }));
      expect(kept.total_cents).toBe(withLegacy.total_cents);
      expect(kept.transactions.find((t: any) => t.description === 'Ajuste de fatura')).toBeUndefined();
      expect(kept.transactions.find((t: any) => t.plan_id).amount_cents).toBe(10000);

      const month = await ok(await agent.get('/api/cards/month/2026-10'));
      expect(month).toEqual([{ card_id: ids.ultra, invoice: expect.objectContaining({ id: inv.id, total_cents: kept.total_cents }) }]);
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
      expect(food.months[10]).toBe(500);
      expect(food.total_cents).toBe(3500);
      expect(food.children.map((c: any) => c.name)).toEqual(['Mercado', 'Restaurante']);
      expect(realized.balance.months[0]).toBe(8000);
      expect(realized.balance.total_cents).toBe(9000 - 3500);

      const planned = await ok(await agent.get('/api/reports/year?year=2026&mode=planned'));
      expect(planned.expense.total_cents).toBe(3500);
    });

    it('a visão anual mostra a conta a pagar e o cartão no mês da fatura', async () => {
      await ok(
        await agent.post('/api/transactions').send({ kind: 'expense', description: 'IPVA', amount_cents: 68361, occurred_on: '2026-10-13', account_id: ids.bradesco, category_id: ids.cat.Moradia, paid: false }),
        201,
      );
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Posto', amount_cents: 4000, occurred_on: '2026-09-05', card_id: ids.ultra, category_id: ids.cat.Mercado }), 201);

      const year = await ok(await agent.get('/api/reports/year?year=2026&mode=realized'));
      const housing = year.expense.rows.find((r: any) => r.name === 'Moradia');
      const market = year.expense.rows.find((r: any) => r.name === 'Alimentação').children.find((c: any) => c.name === 'Mercado');
      expect(housing.months[9]).toBe(68361);
      expect(housing.paid_months[9]).toBe(0);
      expect(market.months[9]).toBe(4000);
      const open = await ok(await agent.get('/api/reports/year/transactions?year=2026&mode=realized&kind=expense&month=10&category=' + ids.cat.Moradia));
      expect(open.transactions.map((t: any) => t.description)).toEqual(['IPVA']);
    });

    it('célula anual só fica paga quando a conta ou a fatura quitou', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Conta', amount_cents: 4000, occurred_on: '2026-10-01', account_id: ids.bradesco, category_id: ids.cat['Mercado'] }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Cartão', amount_cents: 7000, occurred_on: '2026-09-05', card_id: ids.ultra, category_id: ids.cat['Mercado'] }), 201);

      const mercadoOf = (year: any) => year.expense.rows.find((r: any) => r.name === 'Alimentação').children.find((c: any) => c.name === 'Mercado');
      const open = mercadoOf(await ok(await agent.get('/api/reports/year?year=2026&mode=realized')));
      expect(open.months[9]).toBe(11000);
      expect(open.paid_months[9]).toBe(4000);
      expect(open.items.find((i: any) => i.name === 'Conta').paid_months[9]).toBe(4000);
      expect(open.items.find((i: any) => i.name === 'Cartão').paid_months[9]).toBe(0);

      const inv = await ok(await agent.get(`/api/cards/${ids.ultra}/invoices/2026-10`));
      await ok(await agent.post(`/api/invoices/${inv.id}/payments`).send({}), 201);
      const paid = mercadoOf(await ok(await agent.get('/api/reports/year?year=2026&mode=realized')));
      expect(paid.paid_months[9]).toBe(11000);
      expect(paid.items.find((i: any) => i.name === 'Cartão').paid_months[9]).toBe(7000);
    });

    it('cobrança fixa prevista do cartão entra no a pagar e fecha com o total do mês', async () => {
      await ok(
        await agent.post('/api/recurrences').send({ kind: 'expense', description: 'Netflix', amount_cents: 5590, card_id: ids.ultra, day_of_month: 12, start_month: '2026-09' }),
        201,
      );
      const view = await ok(await agent.get('/api/transactions?month=2026-11&kind=expense&person=all'));
      const dash = await ok(await agent.get('/api/dashboard?month=2026-11&person=all'));
      expect(view.summary.total_cents).toBe(5590);
      expect(view.pending_cents).toBe(5590);
      expect(dash.expense.to_pay_cents).toBe(5590);
      expect(dash.expense.paid_cents + dash.expense.to_pay_cents).toBe(dash.expense.total_cents);
    });

    it('"Saiu" do Início só conta o que foi pago, e "a pagar" soma conta e cartão (em Eu e em Nós)', async () => {
      const me = await ok(await agent.get('/api/auth/me'));
      for (const person of ['me', 'all']) {
        const base = (await ok(await agent.get(`/api/dashboard?month=2026-10&person=${person}`))).expense;
        const view = await ok(await agent.get(`/api/transactions?month=2026-10&kind=expense&person=${person}`));
        expect(base.paid_cents).toBe(view.paid_out_cents);
        expect(base.to_pay_cents).toBe(view.pending_cents);
      }
      const before = (await ok(await agent.get('/api/dashboard?month=2026-10&person=me'))).expense;
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Luz', amount_cents: 9000, occurred_on: '2026-10-25', account_id: ids.bradesco, for_user_id: me.id }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Loja', amount_cents: 7000, occurred_on: '2026-09-05', card_id: ids.ultra, for_user_id: me.id }), 201);
      const open = (await ok(await agent.get('/api/dashboard?month=2026-10&person=me'))).expense;
      expect(open.paid_cents - before.paid_cents).toBe(0);
      expect(open.to_pay_cents - before.to_pay_cents).toBe(16000);

      const inv = await ok(await agent.get(`/api/cards/${ids.ultra}/invoices/2026-10`));
      await ok(await agent.post(`/api/invoices/${inv.id}/payments`).send({}), 201);
      const paid = (await ok(await agent.get('/api/dashboard?month=2026-10&person=me'))).expense;
      expect(paid.paid_cents - open.paid_cents).toBeGreaterThanOrEqual(7000);
      expect(paid.paid_cents + paid.to_pay_cents).toBe(open.paid_cents + open.to_pay_cents);
    });

    it('próximo vencimento do cartão é a fatura, e pagá-la lança o que está dentro', async () => {
      const me = await ok(await agent.get('/api/auth/me'));
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Servidor', amount_cents: 20742, occurred_on: '2026-09-05', card_id: ids.ultra, for_user_id: me.id }), 201);
      const mine = await ok(await agent.get('/api/dashboard?month=2026-10&person=me'));
      const cards = mine.upcoming.filter((u: any) => u.type === 'invoice');
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ description: 'Fatura Ultra', amount_cents: 20742, due_on: '2026-10-06' });
      expect(mine.upcoming.filter((u: any) => u.description === 'Servidor')).toHaveLength(0);
      const open = await ok(await agent.get('/api/transactions?month=2026-10&kind=expense&person=me'));
      expect(open.items.find((t: any) => t.description === 'Servidor').display_status).not.toBe('paid');
      const inv = await ok(await agent.get(`/api/cards/${ids.ultra}/invoices/2026-10`));
      await ok(await agent.post(`/api/invoices/${inv.id}/payments`).send({}), 201);
      const paid = await ok(await agent.get('/api/transactions?month=2026-10&kind=expense&person=me'));
      expect(paid.items.find((t: any) => t.description === 'Servidor').display_status).toBe('paid');
      const after = await ok(await agent.get('/api/dashboard?month=2026-10&person=me'));
      expect(after.upcoming.filter((u: any) => u.type === 'invoice')).toHaveLength(0);
    });

    it('compras do cartão viram uma soma no vencimento da fatura', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Mercado', amount_cents: 10000, occurred_on: '2026-09-02', card_id: ids.ultra }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Posto', amount_cents: 5000, occurred_on: '2026-09-03', card_id: ids.ultra }), 201);
      for (let i = 0; i < 8; i++) {
        await ok(
          await agent.post('/api/transactions').send({ kind: 'expense', description: `Conta ${i}`, amount_cents: 100, occurred_on: '2026-10-01', account_id: ids.bradesco, paid: false }),
          201,
        );
      }
      const dash = await ok(await agent.get('/api/dashboard?month=2026-10'));
      const invoices = dash.upcoming.filter((u: any) => u.type === 'invoice');
      expect(invoices).toEqual([expect.objectContaining({ description: 'Fatura Ultra', amount_cents: 15000, due_on: '2026-10-06' })]);
      expect(dash.upcoming.filter((u: any) => u.description === 'Mercado' || u.description === 'Posto')).toHaveLength(0);
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

    it('avatar grava só o tom escolhido', async () => {
      const saved = await ok(await agent.put('/api/gamification/avatar').send({ tone: 3 }));
      expect(saved.avatar).toEqual({ tone: 3, preset: null });
      const g = await ok(await agent.get('/api/gamification'));
      expect(g.members[0]).toMatchObject({ me: true, avatar: { tone: 3, preset: null } });
      const drawn = await ok(await agent.put('/api/gamification/avatar').send({ tone: 3, preset: 1 }));
      expect(drawn.avatar).toEqual({ tone: 3, preset: 1 });
      expect((await agent.put('/api/gamification/avatar').send({ tone: 12 })).status).toBe(400);
      expect((await agent.put('/api/gamification/avatar').send({ tone: 3, preset: 14 })).status).toBe(400);
      expect((await agent.put('/api/gamification/avatar').send({ color: '#1CB0F6' })).status).toBe(400);
    });

    it('grupo anual guarda o banco só quando é um, e cada lançamento guarda o seu', async () => {
      await ok(
        await agent.post('/api/transactions').send({ kind: 'expense', description: 'IPVA', amount_cents: 1000, occurred_on: '2026-10-13', account_id: ids.bradesco, category_id: ids.cat.Moradia, paid: false }),
        201,
      );
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Posto', amount_cents: 2000, occurred_on: '2026-09-05', card_id: ids.ultra, category_id: ids.cat.Moradia }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Consulta', amount_cents: 3000, occurred_on: '2026-10-01', account_id: ids.bradesco, category_id: ids.cat.Saúde }), 201);

      const year = await ok(await agent.get('/api/reports/year?year=2026&mode=realized'));
      const housing = year.expense.rows.find((r: any) => r.name === 'Moradia');
      expect(housing.card_name).toBeNull();
      expect(housing.items.map((i: any) => [i.name, i.card_name])).toEqual([
        ['Posto', 'Ultra · cartão'],
        ['IPVA', 'Bradesco · conta'],
      ]);
      const health = year.expense.rows.find((r: any) => r.name === 'Saúde');
      expect(health.card_name).toBe('Bradesco · conta');
      expect(health.items[0]).toMatchObject({ name: 'Consulta', card_name: 'Bradesco · conta' });
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
      expect(salario.card_name).toBe('Bradesco · conta');
      expect(salario.items).toEqual([
        { key: `d:Salário dia 15::a${ids.bradesco}`, name: 'Salário dia 15', fixed: false, card_name: 'Bradesco · conta', months: [300000, 300000, ...Array(10).fill(0)], paid_months: [300000, 300000, ...Array(10).fill(0)], total_cents: 600000 },
        { key: `d:Salário dia 30::a${ids.bradesco}`, name: 'Salário dia 30', fixed: false, card_name: 'Bradesco · conta', months: [200000, ...Array(11).fill(0)], paid_months: [200000, ...Array(11).fill(0)], total_cents: 200000 },
        { key: `d:::a${ids.bradesco}`, name: 'Sem descrição', fixed: false, card_name: 'Bradesco · conta', months: [0, 1000, ...Array(10).fill(0)], paid_months: [0, 1000, ...Array(10).fill(0)], total_cents: 1000 },
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
      expect(dash.recurrence.map((r: { key: string; total_cents: number }) => r.key)).toEqual(['fixed', 'installment', 'contract', 'variable']);
      expect(dash.recurrence.reduce((sum: number, r: { total_cents: number }) => sum + r.total_cents, 0)).toBe(dash.expense.total_cents);
    });

    it('o total do orçamento não soma a filha quando o pai também está orçado', async () => {
      await ok(await agent.put('/api/budgets').send({ category_id: ids.cat['Alimentação'], month: '2026-10', planned_cents: 100000 }));
      await ok(await agent.put('/api/budgets').send({ category_id: ids.cat['Mercado'], month: '2026-10', planned_cents: 20000 }));
      const b = await ok(await agent.get('/api/budgets?month=2026-10'));
      expect(b.planned_cents).toBe(100000);
    });

    it('o orçado do ano compara o teto de cada mês com o gasto efetivado, só nos meses orçados', async () => {
      await ok(await agent.put('/api/budgets').send({ category_id: ids.cat['Alimentação'], month: '2026-10', planned_cents: 100000 }));
      await ok(await agent.put('/api/budgets').send({ category_id: ids.cat['Alimentação'], month: '2026-11', planned_cents: 50000 }));
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 72000, occurred_on: '2026-10-02', account_id: ids.bradesco, category_id: ids.cat['Mercado'] }), 201);
      // gasto num mês sem orçamento não entra na comparação da categoria
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 9000, occurred_on: '2026-09-02', account_id: ids.bradesco, category_id: ids.cat['Mercado'] }), 201);
      const y = await ok(await agent.get('/api/budgets/year?year=2026'));
      expect(y.months).toHaveLength(12);
      const food = y.items.find((i: any) => i.name === 'Alimentação');
      expect(food).toMatchObject({ planned_cents: 150000, spent_cents: 72000 });
      expect(food.months[8]).toMatchObject({ planned_cents: null, spent_cents: 9000 });
      expect(y.planned_cents).toBe(150000);
      expect(y.spent_cents).toBe(72000);
      expect(y.items.every((i: any) => i.planned_cents > 0)).toBe(true);
    });

    it('"quem gastou" e a composição por subcategoria fecham com o total de despesas, inclusive a compra do cartão', async () => {
      const me = (await ok(await agent.get('/api/auth/me'))).id;
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 1000, occurred_on: '2026-10-03', account_id: ids.bradesco, category_id: ids.cat['Mercado'], for_user_id: me }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 5000, occurred_on: '2026-08-20', card_id: ids.ultra, category_id: ids.cat['Mercado'], for_user_id: me }), 201); // fatura de outubro
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 2000, occurred_on: '2026-08-21', card_id: ids.ultra, category_id: ids.cat['Alimentação'] }), 201); // da casa, direto na categoria pai
      for (const person of ['all', 'me']) {
        const dash = await ok(await agent.get(`/api/dashboard?month=2026-10&person=${person}`));
        const total = dash.expense.total_cents;
        expect(dash.spent_by_person.reduce((a: number, r: any) => a + r.total_cents, 0)).toBe(total);
        expect(dash.category_breakdown.reduce((a: number, r: any) => a + r.total_cents, 0)).toBe(total);
      }
      const all = await ok(await agent.get('/api/dashboard?month=2026-10&person=all'));
      expect(all.expense.total_cents).toBe(8000);
      expect(all.spent_by_person).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ user_id: me, total_cents: 6000 }),
          expect.objectContaining({ user_id: null, name: null, total_cents: 2000 }),
        ]),
      );
      const alimentacao = all.category_breakdown.filter((r: any) => r.parent === 'Alimentação');
      expect(alimentacao.find((r: any) => r.name === 'Mercado').total_cents).toBe(6000);
      expect(alimentacao.find((r: any) => r.name === 'Geral').total_cents).toBe(2000);
      expect(all.categories.find((c: any) => c.name === 'Alimentação').total_cents).toBe(8000);
    });

    it('a evolução vem no painel e termina no mesmo total das despesas, com a compra do cartão no vencimento da fatura', async () => {
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 1000, occurred_on: '2026-10-02', account_id: ids.bradesco }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 5000, occurred_on: '2026-08-20', card_id: ids.ultra }), 201); // fecha em 7/set, vence em 6/out
      for (const person of ['all', 'me']) {
        const dash = await ok(await agent.get(`/api/dashboard?month=2026-10&person=${person}`));
        expect(dash.evolution.current).toHaveLength(31);
        expect(dash.evolution.previous).toHaveLength(30);
        // o fim da linha é o total de despesas do mês, em Nós e em Eu
        expect(dash.evolution.current.at(-1)).toBe(dash.expense.total_cents);
        expect(dash.evolution.previous.at(-1)).toBe((await ok(await agent.get(`/api/dashboard?month=2026-09&person=${person}`))).expense.total_cents);
      }
      const all = await ok(await agent.get('/api/dashboard?month=2026-10&person=all'));
      expect(all.evolution.current[1]).toBe(1000);
      expect(all.evolution.current[4]).toBe(1000);
      expect(all.evolution.current[5]).toBe(6000); // dia 6: a fatura do cartão vence e soma
      expect(all.evolution.current.at(-1)).toBe(6000);
    });

    it('em Eu, o parcelamento do cartão entra uma parcela por mês da fatura', async () => {
      const me = await ok(await agent.get('/api/auth/me'));
      await ok(
        await agent.post('/api/transactions').send({
          kind: 'expense', description: 'BYD', amount_cents: 196400, occurred_on: '2026-10-10', account_id: ids.bradesco, for_user_id: me.id,
        }),
        201,
      );
      await ok(
        await agent.post('/api/installments').send({
          description: 'Notebook', total_cents: 600000, installments: 3, card_id: ids.ultra, purchased_on: '2026-10-20', for_user_id: me.id,
        }),
        201,
      );
      const eu = await ok(await agent.get('/api/dashboard?month=2026-10&person=me'));
      expect(eu.evolution.current[9]).toBe(196400);
      expect(eu.evolution.current[30]).toBe(196400);
      const dec = await ok(await agent.get('/api/dashboard?month=2026-12&person=me'));
      expect(dec.evolution.current[30]).toBe(200000);
      expect(dec.evolution.current[5]).toBe(200000);
    });

    it('o vencimento de conta devolve o id do lançamento', async () => {
      const created = await ok(
        await agent.post('/api/transactions').send({ kind: 'expense', description: 'Luz', amount_cents: 15000, occurred_on: '2026-10-02', account_id: ids.bradesco, paid: false }),
        201,
      );
      const dash = await ok(await agent.get('/api/dashboard?month=2026-10'));
      const row = dash.upcoming.find((u: { type: string; description: string }) => u.type === 'tx' && u.description === 'Luz');
      expect(row.id).toBe(created.transaction.id);
    });
  });

  describe('metas e gamificação', () => {
    it('lançamento não concede XP', async () => {
      const res = await ok(await agent.post('/api/transactions').send({ kind: 'expense', amount_cents: 100, account_id: ids.bradesco }), 201);
      expect(res.xp).toBeUndefined();
      const g = await ok(await agent.get('/api/gamification'));
      expect(g.total_xp).toBe(0);
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

    it('atingir o alvo conclui a meta', async () => {
      const goal = await ok(await agent.post('/api/goals').send({ name: 'Viagem', target_cents: 1000000, saved_cents: 400000 }), 201);
      expect(goal.progress).toBe(0.4);
      const done = await ok(await agent.post(`/api/goals/${goal.id}/deposit`).send({ amount_cents: 600000 }));
      expect(done.goal.completed_at).toBeTruthy();
      expect(done.xp).toBeUndefined();
      const again = await ok(await agent.post(`/api/goals/${goal.id}/deposit`).send({ amount_cents: 100 }));
      expect(again.goal.completed_at).toBeTruthy();
    });

    it('editar a meta conclui e reabre', async () => {
      const goal = await ok(await agent.post('/api/goals').send({ name: 'Reserva', target_cents: 100000, saved_cents: 40000 }), 201);
      const done = await ok(await agent.patch(`/api/goals/${goal.id}`).send({ name: 'Reserva', target_cents: 40000 }));
      expect(done.completed_at).toBeTruthy();
      expect(done.xp).toBeUndefined();
      const reopened = await ok(await agent.patch(`/api/goals/${goal.id}`).send({ name: 'Reserva', target_cents: 100000 }));
      expect(reopened.completed_at).toBeNull();
      const second = await ok(await agent.patch(`/api/goals/${goal.id}`).send({ name: 'Reserva', target_cents: 40000 }));
      expect(second.completed_at).toBeTruthy();
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

    it('a visão anual em Eu tira o outro e a casa, e em Nós soma os dois', async () => {
      await ok(await agent.post('/api/users').send({ name: 'Jhersyka', email: 'jhersyka@x.com', password: 'senha-segura' }), 201);
      const users = await ok(await agent.get('/api/users'));
      const hers = users.find((u: { email: string }) => u.email === 'jhersyka@x.com');
      const me = await ok(await agent.get('/api/auth/me'));
      await ok(await agent.post('/api/transactions').send({ kind: 'income', description: 'Salário Diego', amount_cents: 100000, occurred_on: '2026-10-05', account_id: ids.bradesco, category_id: ids.cat.Pagamentos, for_user_id: me.id }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'income', description: 'Salário Jhersyka', amount_cents: 80000, occurred_on: '2026-10-05', account_id: ids.bradesco, category_id: ids.cat.Pagamentos, for_user_id: hers.id }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Aluguel', amount_cents: 5000, occurred_on: '2026-10-01', account_id: ids.bradesco, category_id: ids.cat.Moradia }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Farmácia', amount_cents: 3000, occurred_on: '2026-10-02', account_id: ids.bradesco, category_id: ids.cat.Saúde, for_user_id: hers.id }), 201);
      await ok(await agent.post('/api/transactions').send({ kind: 'expense', description: 'Mercado', amount_cents: 2000, occurred_on: '2026-10-03', account_id: ids.bradesco, category_id: ids.cat.Alimentação, for_user_id: me.id }), 201);

      const mine = await ok(await agent.get('/api/reports/year?year=2026&mode=realized&person=me'));
      expect(mine.income.total_cents).toBe(100000);
      expect(mine.expense.total_cents).toBe(2000);
      const both = await ok(await agent.get('/api/reports/year?year=2026&mode=realized&person=all'));
      expect(both.income.total_cents).toBe(180000);
      expect(both.expense.total_cents).toBe(10000);
      const house = await ok(await agent.get('/api/reports/year?year=2026&mode=realized'));
      expect(house.income.total_cents).toBe(180000);

      const mineIncome = await ok(await agent.get('/api/reports/year/transactions?year=2026&mode=realized&kind=income&person=me'));
      expect(mineIncome.transactions.map((item: { description: string }) => item.description)).toEqual(['Salário Diego']);
      const allExpenses = await ok(await agent.get('/api/reports/year/transactions?year=2026&mode=realized&kind=expense&person=all'));
      expect(allExpenses.transactions.map((item: { description: string }) => item.description).sort()).toEqual(['Aluguel', 'Farmácia', 'Mercado']);
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
