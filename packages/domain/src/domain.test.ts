import { describe, expect, it } from 'vitest';
import {
  addMonths,
  cardLimit,
  closingAdjustments,
  computeInvoiceBalances,
  currentBalance,
  cycleForReference,
  dateInMonth,
  deriveStatus,
  classifyRecurrence,
  forecastBalance,
  formatBRL,
  invoiceForPurchase,
  inkOn,
  isISODate,
  isoWeek,
  levelFromXp,
  nextStreak,
  parseBRL,
  relatedColor,
  recurringChargeDate,
  sameColor,
  splitInstallments,
  visibleStreak,
  type Movement,
} from './index';

describe('dinheiro', () => {
  it('formata centavos em reais', () => {
    expect(formatBRL(1990)).toBe('R$ 19,90');
    expect(formatBRL(1151118)).toBe('R$ 11.511,18');
    expect(formatBRL(-500)).toBe('-R$ 5,00');
    expect(formatBRL(0)).toBe('R$ 0,00');
  });

  it('converte texto em centavos sem ponto flutuante', () => {
    expect(parseBRL('19,90')).toBe(1990);
    expect(parseBRL('R$ 1.234,56')).toBe(123456);
    expect(parseBRL('1234.56')).toBe(123456);
    expect(parseBRL('1.234')).toBe(123400);
    expect(parseBRL('0,1')).toBe(10);
    expect(parseBRL('19')).toBe(1900);
    expect(parseBRL('abc')).toBeNull();
    expect(parseBRL('1,234')).toBeNull();
    expect(parseBRL('')).toBeNull();
  });
});

describe('datas', () => {
  it('ajusta dia ao mês curto', () => {
    expect(dateInMonth('2026-02', 31)).toBe('2026-02-28');
    expect(dateInMonth('2028-02', 30)).toBe('2028-02-29');
  });
  it('soma meses atravessando o ano', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
  it('valida datas ISO', () => {
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('2026-10-08')).toBe(true);
  });
  it('calcula semana ISO', () => {
    expect(isoWeek('2026-10-08')).toBe('2026-W41');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
  });
});

describe('status derivado', () => {
  const today = '2026-10-08';
  it('pago quando há data de pagamento', () => {
    expect(deriveStatus({ occurred_on: '2026-10-01', paid_on: '2026-10-01' }, today)).toBe('paid');
  });
  it('atrasado quando venceu sem pagar', () => {
    expect(deriveStatus({ occurred_on: '2026-10-01', due_on: '2026-10-07' }, today)).toBe('overdue');
  });
  it('próximo dentro de 7 dias', () => {
    expect(deriveStatus({ occurred_on: '2026-10-15' }, today)).toBe('near');
    expect(deriveStatus({ occurred_on: '2026-10-08' }, today)).toBe('near');
  });
  it('previsto quando distante', () => {
    expect(deriveStatus({ occurred_on: '2026-10-30' }, today)).toBe('planned');
  });
  it('compra no cartão tem status próprio', () => {
    expect(deriveStatus({ occurred_on: '2026-10-01', card_id: 1 }, today)).toBe('card');
  });
  it('classifica fixa, parcelada e variável', () => {
    expect(classifyRecurrence({ recurrence_id: 1 })).toBe('fixed');
    expect(classifyRecurrence({ plan_id: 1 })).toBe('installment');
    expect(classifyRecurrence({})).toBe('variable');
  });
});

describe('cores de subgrupo', () => {
  it('muda a cor pelo nome e não repete a do grupo', () => {
    const parent = '#1CB0F6';
    const ipva = relatedColor(parent, 'IPVA');
    const seguro = relatedColor(parent, 'Seguro');
    expect(sameColor(ipva, parent)).toBe(false);
    expect(sameColor(ipva, seguro)).toBe(false);
    expect(relatedColor(parent, 'IPVA')).toBe(ipva);
  });

  it('escolhe tinta legível no fundo', () => {
    expect(inkOn('#FFC800')).toBe('#12330a');
    expect(inkOn('#2B70C9')).toBe('#ffffff');
  });
});

describe('parcelamento', () => {
  it('soma exatamente o total e distribui o resto nas primeiras', () => {
    expect(splitInstallments(10000, 3)).toEqual([3334, 3333, 3333]);
    const parts = splitInstallments(11784000, 60);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(11784000);
    expect(parts.every((p) => p === 196400)).toBe(true);
  });
  it('rejeita totais inválidos', () => {
    expect(() => splitInstallments(2, 3)).toThrow();
    expect(() => splitInstallments(10.5, 2)).toThrow();
  });
});

describe('fatura', () => {
  const ultra = { closing_day: 7, due_day: 6 };
  const cartao1 = { closing_day: 3, due_day: 10 };

  it('vencimento antes do fechamento: fatura vence no mês seguinte ao fechamento', () => {
    expect(invoiceForPurchase(ultra, '2026-09-06')).toEqual({ reference_month: '2026-10', closing_date: '2026-09-07', due_date: '2026-10-06' });
    expect(invoiceForPurchase(ultra, '2026-09-07').reference_month).toBe('2026-11');
  });

  it('vencimento depois do fechamento: fatura vence no mesmo mês', () => {
    expect(invoiceForPurchase(cartao1, '2026-10-02')).toEqual({ reference_month: '2026-10', closing_date: '2026-10-03', due_date: '2026-10-10' });
    expect(invoiceForPurchase(cartao1, '2026-10-18').reference_month).toBe('2026-11');
  });

  it('ciclo pelo mês de referência', () => {
    expect(cycleForReference(ultra, '2026-10')).toEqual({ reference_month: '2026-10', closing_date: '2026-09-07', due_date: '2026-10-06' });
  });

  it('recorrência no cartão cai exatamente na fatura pedida', () => {
    for (const ref of ['2026-10', '2026-11', '2027-02', '2027-03']) {
      for (const day of [1, 6, 7, 15, 28, 31]) {
        const date = recurringChargeDate(ultra, ref, day);
        expect(invoiceForPurchase(ultra, date).reference_month).toBe(ref);
      }
    }
  });

  it('pagamento maior que a fatura vira crédito na seguinte', () => {
    const today = '2026-11-20';
    const [oct, nov, dec] = computeInvoiceBalances(
      [
        { id: 1, reference_month: '2026-10', closing_date: '2026-09-07', due_date: '2026-10-06', total_cents: 50000, paid_cents: 70000 },
        { id: 2, reference_month: '2026-11', closing_date: '2026-10-07', due_date: '2026-11-06', total_cents: 30000, paid_cents: 0 },
        { id: 3, reference_month: '2026-12', closing_date: '2026-11-07', due_date: '2026-12-06', total_cents: 10000, paid_cents: 0 },
      ],
      today,
    );
    expect(oct.remaining_cents).toBe(0);
    expect(oct.credit_out_cents).toBe(20000);
    expect(nov.credit_in_cents).toBe(20000);
    expect(nov.remaining_cents).toBe(10000);
    expect(nov.state).toBe('overdue');
    expect(dec.state).toBe('closed');
  });

  it('marca a primeira fatura ainda não fechada como aberta', () => {
    const list = computeInvoiceBalances(
      [
        { id: 2, reference_month: '2026-11', closing_date: '2026-10-07', due_date: '2026-11-06', total_cents: 100, paid_cents: 0 },
        { id: 3, reference_month: '2026-12', closing_date: '2026-11-07', due_date: '2026-12-06', total_cents: 100, paid_cents: 0 },
        { id: 4, reference_month: '2027-01', closing_date: '2026-12-07', due_date: '2027-01-06', total_cents: 100, paid_cents: 0 },
      ],
      '2026-10-08',
    );
    expect(list.map((i) => i.state)).toEqual(['closed', 'open', 'future']);
  });

  it('limite disponível = limite - comprometido, sem passar do limite', () => {
    expect(cardLimit(1410000, 873601, 0)).toMatchObject({ committed_cents: 873601, available_cents: 536399 });
    expect(cardLimit(1410000, 50000, 80000)).toMatchObject({ committed_cents: 0, available_cents: 1410000 });
  });
});

describe('saldo', () => {
  const account = { initial_balance_cents: 450000, initial_balance_on: '2026-10-01' };
  const movements: Movement[] = [
    { date: '2026-09-30', signed_cents: -99999, realized: true, source: 'expense' },
    { date: '2026-10-05', signed_cents: 333536, realized: true, source: 'income' },
    { date: '2026-10-06', signed_cents: -50000, realized: true, source: 'invoice_payment' },
    { date: '2026-10-07', signed_cents: -10000, realized: true, source: 'transfer_out' },
    { date: '2026-10-15', signed_cents: 499436, realized: false, source: 'income' },
    { date: '2026-10-20', signed_cents: -196400, realized: false, source: 'expense' },
    { date: '2026-11-06', signed_cents: -187406, realized: false, source: 'invoice_due' },
  ];

  it('saldo atual ignora previstos e movimentos anteriores ao saldo inicial', () => {
    expect(currentBalance(account, movements, '2026-10-08')).toBe(450000 + 333536 - 50000 - 10000);
  });

  it('saldo previsto soma o planejado até o horizonte', () => {
    expect(forecastBalance(account, movements, '2026-10-08', '2026-10-31')).toBe(723536 + 499436 - 196400);
    expect(forecastBalance(account, movements, '2026-10-08', '2026-11-30')).toBe(723536 + 499436 - 196400 - 187406);
  });

  it('correção do fim do mês só entra no saldo atual depois que o mês fecha', () => {
    const forecast = forecastBalance(account, movements, '2026-10-08', '2026-10-31');
    const [adjustment] = closingAdjustments(account, movements, [{ month: '2026-10', closing_cents: 100000 }], '2026-10-08');
    expect(adjustment).toMatchObject({ date: '2026-10-31', signed_cents: 100000 - forecast, realized: false, source: 'balance_adjustment' });
    const withIt = [...movements, adjustment];
    expect(forecastBalance(account, withIt, '2026-10-08', '2026-10-31')).toBe(100000);
    expect(currentBalance(account, withIt, '2026-10-08')).toBe(currentBalance(account, movements, '2026-10-08'));
    const [closed] = closingAdjustments(account, movements, [{ month: '2026-10', closing_cents: 100000 }], '2026-11-01');
    expect(closed.realized).toBe(true);
  });
});

describe('gamificação', () => {
  it('nível derivado do XP', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(49)).toBe(1);
    expect(levelFromXp(50)).toBe(2);
    expect(levelFromXp(200)).toBe(3);
  });

  it('sequência continua em dias seguidos e reinicia após falha', () => {
    let s = { current_days: 0, longest_days: 0, last_activity_date: null as string | null };
    s = nextStreak(s, '2026-10-01');
    s = nextStreak(s, '2026-10-02');
    s = nextStreak(s, '2026-10-02');
    expect(s).toEqual({ current_days: 2, longest_days: 2, last_activity_date: '2026-10-02' });
    s = nextStreak(s, '2026-10-05');
    expect(s.current_days).toBe(1);
    expect(s.longest_days).toBe(2);
    expect(visibleStreak(s, '2026-10-06')).toBe(1);
    expect(visibleStreak(s, '2026-10-07')).toBe(0);
  });
});
