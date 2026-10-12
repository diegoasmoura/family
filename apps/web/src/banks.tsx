import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './ui';

export interface Bank {
  id: string;
  name: string;
  color: string;
  aliases: string[];
  mark: ReactNode;
}

const word = (label: string, fill: string, size = 11) => (
  <text
    x="16"
    y="21"
    textAnchor="middle"
    fill={fill}
    fontSize={size}
    fontWeight="800"
    fontFamily="Nunito, sans-serif"
    {...(label.length > 3 ? { textLength: 26, lengthAdjust: 'spacingAndGlyphs' as const } : {})}
  >
    {label}
  </text>
);

const tile = (bg: string, children: ReactNode, rx = 8) => (
  <>
    <rect width="32" height="32" rx={rx} fill={bg} />
    {children}
  </>
);

export const BANKS: Bank[] = [
  {
    id: 'nubank',
    name: 'Nubank',
    color: '#820AD1',
    aliases: ['nu'],
    mark: tile('#820AD1', word('nu', '#fff', 15)),
  },
  {
    id: 'bradesco',
    name: 'Bradesco',
    color: '#CC092F',
    aliases: [],
    mark: tile('#CC092F', word('br', '#fff', 15)),
  },
  {
    id: 'itau',
    name: 'Itaú',
    color: '#EC7000',
    aliases: ['itau', 'itau unibanco'],
    mark: tile('#EC7000', word('itaú', '#003399', 9)),
  },
  {
    id: 'bb',
    name: 'Banco do Brasil',
    color: '#003882',
    aliases: ['bb', 'brasil'],
    mark: tile('#FFEF38', word('BB', '#003882', 13)),
  },
  {
    id: 'caixa',
    name: 'Caixa',
    color: '#005CA9',
    aliases: ['cef', 'caixa economica'],
    mark: tile('#005CA9', word('caixa', '#fff', 8)),
  },
  {
    id: 'santander',
    name: 'Santander',
    color: '#EC0000',
    aliases: [],
    mark: tile('#EC0000', word('san', '#fff', 12)),
  },
  {
    id: 'inter',
    name: 'Inter',
    color: '#FF7A00',
    aliases: ['banco inter'],
    mark: tile('#FF7A00', word('inter', '#fff', 8)),
  },
  {
    id: 'c6',
    name: 'C6 Bank',
    color: '#1A1A1A',
    aliases: ['c6'],
    mark: tile('#1A1A1A', word('C6', '#fff', 13)),
  },
  {
    id: 'btg',
    name: 'BTG Pactual',
    color: '#0C0C0C',
    aliases: ['btg'],
    mark: tile('#0C0C0C', word('btg', '#C6A15B', 12)),
  },
  {
    id: 'xp',
    name: 'XP',
    color: '#111111',
    aliases: ['xp investimentos'],
    mark: tile('#111111', word('XP', '#FFD100', 13)),
  },
  {
    id: 'picpay',
    name: 'PicPay',
    color: '#21C25E',
    aliases: ['pic pay'],
    mark: tile('#21C25E', word('P', '#fff', 16)),
  },
  {
    id: 'mercadopago',
    name: 'Mercado Pago',
    color: '#009EE3',
    aliases: ['mercadopago', 'mp'],
    mark: tile('#009EE3', word('MP', '#fff', 12)),
  },
  {
    id: 'pagbank',
    name: 'PagBank',
    color: '#00A868',
    aliases: ['pagseguro', 'pag bank'],
    mark: tile('#00A868', word('pag', '#fff', 11)),
  },
  {
    id: 'neon',
    name: 'Neon',
    color: '#00D4C8',
    aliases: [],
    mark: tile('#0E1A2B', word('neon', '#00E5D4', 8)),
  },
  {
    id: 'will',
    name: 'Will Bank',
    color: '#FFCC00',
    aliases: ['will'],
    mark: tile('#FFCC00', word('will', '#1A1A1A', 9)),
  },
  {
    id: 'pan',
    name: 'Banco Pan',
    color: '#00AEEF',
    aliases: ['pan'],
    mark: tile('#00AEEF', word('pan', '#fff', 11)),
  },
  {
    id: 'original',
    name: 'Original',
    color: '#00A651',
    aliases: ['banco original'],
    mark: tile('#00A651', word('orig', '#fff', 8)),
  },
  {
    id: 'next',
    name: 'Next',
    color: '#00D46A',
    aliases: ['banco next'],
    mark: tile('#111111', word('next', '#00D46A', 8)),
  },
  {
    id: 'sicoob',
    name: 'Sicoob',
    color: '#003641',
    aliases: [],
    mark: tile('#003641', word('sicoob', '#7AC143', 6.5)),
  },
  {
    id: 'sicredi',
    name: 'Sicredi',
    color: '#3FA110',
    aliases: [],
    mark: tile('#3FA110', word('sicredi', '#fff', 6.2)),
  },
  {
    id: 'banrisul',
    name: 'Banrisul',
    color: '#003366',
    aliases: [],
    mark: tile('#003366', word('banri', '#fff', 7.5)),
  },
  {
    id: 'safra',
    name: 'Safra',
    color: '#0A2F6B',
    aliases: ['banco safra'],
    mark: tile('#0A2F6B', word('safra', '#C6A15B', 8)),
  },
  {
    id: 'bmg',
    name: 'BMG',
    color: '#FF6600',
    aliases: ['banco bmg'],
    mark: tile('#FF6600', word('BMG', '#fff', 10)),
  },
  {
    id: 'digio',
    name: 'Digio',
    color: '#00205B',
    aliases: [],
    mark: tile('#00205B', word('digio', '#fff', 9)),
  },
];

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
  return (
    <svg className="bank-logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      {bank.mark}
    </svg>
  );
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
