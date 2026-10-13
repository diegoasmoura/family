import { useEffect, useRef, useState } from 'react';
import { banks as brandBanks } from 'react-bancos';
import { Icon } from './ui';

export interface Bank {
  id: string;
  name: string;
  color: string;
  aliases: string[];
  Icon: (typeof brandBanks)[number]['Icon'];
}

const bySlug = new Map(brandBanks.map((bank) => [bank.slug, bank]));

const CURATED: { slug: string; name: string; aliases: string[] }[] = [
  { slug: 'nubank', name: 'Nubank', aliases: ['nu'] },
  { slug: 'bradesco', name: 'Bradesco', aliases: [] },
  { slug: 'itau', name: 'Itaú', aliases: ['itau', 'itau unibanco'] },
  { slug: 'bancodobrasil', name: 'Banco do Brasil', aliases: ['bb', 'brasil'] },
  { slug: 'caixa', name: 'Caixa', aliases: ['cef', 'caixa economica'] },
  { slug: 'santander', name: 'Santander', aliases: [] },
  { slug: 'inter', name: 'Inter', aliases: ['banco inter'] },
  { slug: 'c6bank', name: 'C6 Bank', aliases: ['c6'] },
  { slug: 'btgpactual', name: 'BTG Pactual', aliases: ['btg'] },
  { slug: 'xp', name: 'XP', aliases: ['xp investimentos'] },
  { slug: 'picpay', name: 'PicPay', aliases: ['pic pay'] },
  { slug: 'mercadopago', name: 'Mercado Pago', aliases: ['mercadopago', 'mp'] },
  { slug: 'pagbank', name: 'PagBank', aliases: ['pagseguro', 'pag bank'] },
  { slug: 'neon', name: 'Neon', aliases: [] },
  { slug: 'willbank', name: 'Will Bank', aliases: ['will'] },
  { slug: 'pan', name: 'Banco Pan', aliases: ['pan'] },
  { slug: 'original', name: 'Original', aliases: ['banco original'] },
  { slug: 'next', name: 'Next', aliases: ['banco next'] },
  { slug: 'sicoob', name: 'Sicoob', aliases: [] },
  { slug: 'sicredi', name: 'Sicredi', aliases: [] },
  { slug: 'banrisul', name: 'Banrisul', aliases: [] },
  { slug: 'safra', name: 'Safra', aliases: ['banco safra'] },
  { slug: 'bmg', name: 'BMG', aliases: ['banco bmg'] },
  { slug: 'digio', name: 'Digio', aliases: [] },
];

export const BANKS: Bank[] = CURATED.flatMap(({ slug, name, aliases }) => {
  const brand = bySlug.get(slug);
  if (!brand) return [];
  return [{ id: slug, name, color: brand.color ?? '#8E9AAF', aliases, Icon: brand.Icon }];
});

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function bankByName(name: string): Bank | undefined {
  const n = norm(name);
  if (!n) return undefined;
  return [...BANKS]
    .sort((a, b) => norm(b.name).length - norm(a.name).length)
    .find((b) => [b.name, ...b.aliases].map(norm).some((k) => n === k || n.startsWith(`${k} `)));
}

export function BankLogo({ bank, size = 28 }: { bank: Bank; size?: number }) {
  return <bank.Icon className="bank-logo" size={size} radius={Math.round(size * 0.28)} aria-hidden />;
}

/** Logo quando o nome é de um banco da lista. Com fallback, um círculo com as iniciais. */
export function BankMark({ name, size = 28, fallback = false }: { name: string; size?: number; fallback?: boolean }) {
  const bank = bankByName(name);
  if (bank) return <BankLogo bank={bank} size={size} />;
  if (!fallback || !name.trim()) return null;
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toLowerCase();
  return (
    <span className="card-logo" style={{ width: size, height: size, background: 'var(--line)', color: 'var(--ink)', fontSize: size * 0.38 }} aria-hidden>
      {initials}
    </span>
  );
}

export function BankPicker({ name, onChange }: { name: string; onChange: (name: string, color: string | null) => void }) {
  const matched = bankByName(name);
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState(() => name.trim() !== '' && !bankByName(name));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const pick = (bank: Bank) => {
    setOther(false);
    setOpen(false);
    onChange(bank.name, bank.color);
  };

  return (
    <div className="bank-field" ref={ref}>
      <button type="button" className="bank-pick" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {matched ? <BankLogo bank={matched} size={26} /> : null}
        <span className={matched || other ? undefined : 'ph'}>{matched ? matched.name : other ? 'Outro' : 'Escolher o banco'}</span>
        <span className="chev">
          <Icon.right />
        </span>
      </button>
      {open && (
        <div className="bank-list" role="listbox" aria-label="Bancos">
          {BANKS.map((b) => (
            <button key={b.id} type="button" role="option" aria-selected={matched?.id === b.id} className={matched?.id === b.id ? 'on' : undefined} onClick={() => pick(b)}>
              <BankLogo bank={b} size={28} />
              {b.name}
            </button>
          ))}
          <button
            type="button"
            role="option"
            aria-selected={other}
            className={other ? 'on' : undefined}
            onClick={() => {
              setOther(true);
              setOpen(false);
              if (matched) onChange('', null);
            }}
          >
            <span className="card-logo" style={{ width: 28, height: 28, background: 'var(--line)', color: 'var(--ink)', fontSize: 12 }} aria-hidden>
              +
            </span>
            Outro
          </button>
        </div>
      )}
      {other && (
        <input className="inp" value={matched ? '' : name} onChange={(e) => onChange(e.target.value, null)} placeholder="Nome do banco" required autoFocus />
      )}
    </div>
  );
}
