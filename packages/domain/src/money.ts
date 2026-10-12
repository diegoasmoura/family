/** Valores monetários são sempre inteiros em centavos. */
export type Cents = number;

export function isCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatBRL(cents: Cents, opts: { sign?: boolean } = {}): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const reais = groupThousands(Math.floor(abs / 100).toString());
  const frac = (abs % 100).toString().padStart(2, '0');
  const prefix = negative ? '-' : opts.sign && cents > 0 ? '+' : '';
  return `${prefix}R$ ${reais},${frac}`;
}

/** Formato da visão anual: valores em R$ mil com uma casa ("5,2"). */
export function formatThousands(cents: Cents): string {
  if (cents === 0) return '–';
  return (cents / 100_000).toFixed(1).replace('.', ',');
}

/**
 * Converte texto digitado em centavos sem passar por ponto flutuante.
 * Aceita "1.234,56", "1234,56", "R$ 19,90", "19", "19.90" e "1.234".
 */
export function parseBRL(input: string): Cents | null {
  const cleaned = input.replace(/R\$|\s/g, '');
  if (!cleaned) return null;
  const negative = cleaned.startsWith('-');
  const body = negative ? cleaned.slice(1) : cleaned;

  let intPart: string;
  let fracPart = '';
  if (body.includes(',')) {
    const [i, f, ...rest] = body.split(',');
    if (rest.length) return null;
    intPart = i.replace(/\./g, '');
    fracPart = f;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(body)) {
    intPart = body.replace(/\./g, '');
  } else if (body.includes('.')) {
    const idx = body.lastIndexOf('.');
    intPart = body.slice(0, idx).replace(/\./g, '');
    fracPart = body.slice(idx + 1);
  } else {
    intPart = body;
  }

  if (intPart === '') intPart = '0';
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(fracPart)) return null;
  const cents = Number(intPart) * 100 + Number(fracPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function sumCents(values: Cents[]): Cents {
  return values.reduce((acc, v) => acc + v, 0);
}
