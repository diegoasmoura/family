/** Datas 'YYYY-MM-DD' e competências 'YYYY-MM', sempre como texto. */
export type ISODate = string;
export type Month = string;

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isISODate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  return d <= daysInMonth(`${y}-${String(m).padStart(2, '0')}`);
}

export function isMonth(value: string): boolean {
  return MONTH_RE.test(value);
}

export function monthOf(date: ISODate): Month {
  return date.slice(0, 7);
}

export function yearOf(value: ISODate | Month): number {
  return Number(value.slice(0, 4));
}

export function addMonths(month: Month, n: number): Month {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function daysInMonth(month: Month): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Dia do mês respeitando meses curtos: dia 31 em fevereiro vira 28/29. */
export function dateInMonth(month: Month, day: number): ISODate {
  const d = Math.min(day, daysInMonth(month));
  return `${month}-${String(d).padStart(2, '0')}`;
}

export function dayOf(date: ISODate): number {
  return Number(date.slice(8, 10));
}

export function addMonthsToDate(date: ISODate, n: number): ISODate {
  return dateInMonth(addMonths(monthOf(date), n), dayOf(date));
}

function toUTC(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: ISODate, n: number): ISODate {
  return new Date(toUTC(date) + n * 86_400_000).toISOString().slice(0, 10);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(a) - toUTC(b)) / 86_400_000);
}

export function monthRange(from: Month, to: Month): Month[] {
  const out: Month[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function lastDayOfMonth(month: Month): ISODate {
  return dateInMonth(month, 31);
}

/** "Hoje" no fuso do household. */
export function todayIn(timezone: string, now: Date = new Date()): ISODate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const MONTHS_SHORT_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export const WEEKDAYS_SHORT_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function monthLabel(month: Month): string {
  return `${MONTHS_PT[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

export function weekdayShort(date: ISODate): string {
  return WEEKDAYS_SHORT_PT[new Date(toUTC(date)).getUTCDay()];
}

/** Semana ISO 'YYYY-Www', usada para a revisão semanal. */
export function isoWeek(date: ISODate): string {
  const t = new Date(toUTC(date));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
