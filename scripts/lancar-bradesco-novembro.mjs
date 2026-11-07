/**
 * Lança a fatura Bradesco de novembro/2026 (vencimento 15/11/2026) na conta da Jhersyka.
 *
 * Sem --aplicar: entra, acha o cartão e mostra onde cada valor cairia.
 * Com --aplicar: grava. Os ids são da segunda geração: a primeira ficou nos lançamentos apagados.
 * Rodar esta versão de novo não duplica.
 *
 *   FIN_BASE=http://IP-DO-NAS:3003 \
 *   FIN_EMAIL=jhersyka@live.com \
 *   FIN_PASSWORD='senha' \
 *   node scripts/lancar-bradesco-novembro.mjs --aplicar
 *
 * A senha fica só no ambiente. Não grave este arquivo com a senha dentro.
 */

const base = (process.env.FIN_BASE ?? '').replace(/\/$/, '');
const email = process.env.FIN_EMAIL ?? '';
const password = process.env.FIN_PASSWORD ?? '';
const aplicar = process.argv.includes('--aplicar');

if (!base || !email || !password) {
  console.error('Defina FIN_BASE, FIN_EMAIL e FIN_PASSWORD.');
  process.exit(1);
}

/** Centavos. Complemento = fatura 2566,91 − Preply 669,06. */
const COMPLEMENTO = 189_785;
const PREPLY = 66_906;

/** Última parcela, em dezembro. O plano do app exige no mínimo 2. */
const ULTIMAS = [
  { uuid: 'bradesco-2026-11-v2-amz-0208', description: 'Amazon Marketplace 02/08 (4/4)', cents: 5_622 },
  { uuid: 'bradesco-2026-11-v2-araujo', description: 'Araujo Loja 10/09 (3/3)', cents: 15_000 },
  { uuid: 'bradesco-2026-11-v2-cea', description: 'CEA 11/09 (3/3)', cents: 10_332 },
  { uuid: 'bradesco-2026-11-v2-boticario', description: 'O Boticário 13/09 (3/3)', cents: 5_333 },
  { uuid: 'bradesco-2026-11-v2-amz-2209', description: 'Amazon Marketplace 22/09 (3/3)', cents: 14_041 },
  { uuid: 'bradesco-2026-11-v2-amz-2609', description: 'Amazon Marketplace 26/09 (3/3)', cents: 7_929 },
  { uuid: 'bradesco-2026-11-v2-lojasg', description: 'Lojas G 11/10 (2/2)', cents: 6_997 },
];

/** Parcelas que ainda têm dezembro e pelo menos mais um mês. */
const PLANOS = [
  { uuid: 'bradesco-2026-11-v2-ranigami', description: 'Shopee Ranigami 12/10', parcela: 7_289, n: 2 },
  { uuid: 'bradesco-2026-11-v2-amz-2010', description: 'Amazon Marketplace 20/10', parcela: 14_186, n: 3 },
];

const futuras = ULTIMAS.reduce((a, x) => a + x.cents, 0) + PLANOS.reduce((a, x) => a + x.parcela * x.n, 0);
if (futuras !== 122_390) throw new Error(`Próximas faturas deveria ser 122390, saiu ${futuras}`);
if (COMPLEMENTO + PREPLY !== 256_691) throw new Error('Novembro não fecha a fatura');

function pad(n) {
  return String(n).padStart(2, '0');
}
function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
function dateInMonth(month, day) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${pad(Math.min(day, last))}`;
}
function nextDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}
function invoiceMonth(card, iso) {
  const month = iso.slice(0, 7);
  const closing = dateInMonth(month, card.closing_day);
  const closingMonth = iso < closing ? month : addMonths(month, 1);
  return card.due_day > card.closing_day ? closingMonth : addMonths(closingMonth, 1);
}
function dateForInvoice(card, target) {
  let iso = `${addMonths(target, -1)}-01`;
  for (let i = 0; i < 70; i++) {
    if (invoiceMonth(card, iso) === target) return iso;
    iso = nextDay(iso);
  }
  throw new Error(`Nenhuma data cai na fatura ${target}`);
}
function dayForInvoice(card, target, prefer) {
  const closingMonth = card.due_day > card.closing_day ? target : addMonths(target, -1);
  const months = [closingMonth, addMonths(closingMonth, -1)];
  const fits = (day) => months.some((m) => invoiceMonth(card, dateInMonth(m, day)) === target);
  if (fits(prefer)) return prefer;
  for (let day = 1; day <= 28; day++) if (fits(day)) return day;
  throw new Error(`Nenhum dia da fixa cai em ${target}`);
}
function reais(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

let cookie = '';
async function api(path, opts = {}) {
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length) cookie = raw.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = body?.error ?? body?.message ?? text;
    throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status} ${msg}`);
  }
  return { status: res.status, body };
}

const me = (await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })).body;
const cards = (await api('/api/cards?person=all')).body;
const dela = cards.filter((c) => Number(c.for_user_id) === Number(me.id) && !c.archived);
const bradesco = dela.filter((c) => /bradesco/i.test(c.name));
if (bradesco.length !== 1) {
  console.error('Cartões desta usuária:', dela.map((c) => `${c.id} ${c.name} fecha ${c.closing_day} vence ${c.due_day}`).join(' | ') || '(nenhum)');
  throw new Error(bradesco.length === 0 ? 'Não achei um cartão Bradesco no nome dela.' : 'Há mais de um Bradesco. Deixe só um ativo.');
}
const card = bradesco[0];
const cicloPdf = card.closing_day === 3 && card.due_day === 15;
const nov = dateForInvoice(card, '2026-11');
const dez = dateForInvoice(card, '2026-12');
const diaPreply = dayForInvoice(card, '2026-11', 22);

console.log(`${me.name} <${me.email}> · ${me.household_name}`);
console.log(`Cartão ${card.name} (#${card.id}), fecha dia ${card.closing_day}, vence dia ${card.due_day}${cicloPdf ? '' : ' — a fatura em PDF fecha dia 3 e vence dia 15'}`);
console.log('');
console.log(`Novembro  Complemento cartão          ${reais(COMPLEMENTO)}  (compra em ${nov})`);
console.log(`Novembro  Preply (fixa, dia ${diaPreply})       ${reais(PREPLY)}  todo mês, a partir de 2026-11`);
console.log('Dezembro  última parcela de cada compra que acaba agora');
for (const item of ULTIMAS) console.log(`          ${item.description.padEnd(36)} ${reais(item.cents)}`);
console.log('Dezembro em diante  planos (a 1ª parcela cai em dezembro; o contador recomeça em 1)');
for (const item of PLANOS) {
  console.log(`          ${item.description.padEnd(36)} ${item.n}× ${reais(item.parcela)} = ${reais(item.parcela * item.n)}`);
}
console.log('');
console.log(`Novembro lançado ${reais(COMPLEMENTO + PREPLY)} (a fatura). Próximas faturas ${reais(futuras)}.`);

if (!aplicar) {
  console.log('\nNada foi gravado. Rode de novo com --aplicar.');
  process.exit(0);
}

const comum = { card_id: card.id, for_user_id: me.id, kind: 'expense' };

const comp = await api('/api/transactions', {
  method: 'POST',
  body: JSON.stringify({
    ...comum,
    client_uuid: 'bradesco-2026-11-v2-complemento',
    description: 'Complemento cartão',
    amount_cents: COMPLEMENTO,
    occurred_on: nov,
  }),
});
console.log(comp.status === 201 ? 'Gravou Complemento cartão' : 'Complemento cartão já existia');

const fixa = await api('/api/recurrences', {
  method: 'POST',
  body: JSON.stringify({
    ...comum,
    client_uuid: 'bradesco-2026-11-v2-preply',
    description: 'Preply',
    amount_cents: PREPLY,
    day_of_month: diaPreply,
    start_month: '2026-11',
  }),
});
console.log(fixa.status === 201 ? 'Gravou a fixa Preply' : 'Preply já existia');

for (const item of ULTIMAS) {
  const res = await api('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({
      ...comum,
      client_uuid: item.uuid,
      description: item.description,
      amount_cents: item.cents,
      occurred_on: dez,
    }),
  });
  console.log(`${res.status === 201 ? 'Gravou' : 'Já existia'} ${item.description}`);
}

for (const item of PLANOS) {
  const res = await api('/api/installments', {
    method: 'POST',
    body: JSON.stringify({
      client_uuid: item.uuid,
      description: item.description,
      total_cents: item.parcela * item.n,
      installments: item.n,
      card_id: card.id,
      for_user_id: me.id,
      purchased_on: dez,
    }),
  });
  console.log(`${res.status === 201 ? 'Gravou' : 'Já existia'} ${item.description}`);
}

console.log('Pronto.');
