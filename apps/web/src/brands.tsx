import { useEffect, useRef, useState } from 'react';
import { PaymentIcon, type PaymentType } from 'react-svg-credit-card-payment-icons';
import { Icon } from './ui';

export interface Brand {
  id: string;
  name: string;
  type: PaymentType;
  aliases: string[];
}

/** Bandeiras que circulam no Brasil, com o desenho da biblioteca de cartões. */
export const BRANDS: Brand[] = [
  { id: 'visa', name: 'Visa', type: 'Visa', aliases: [] },
  { id: 'mastercard', name: 'Mastercard', type: 'Mastercard', aliases: ['master'] },
  { id: 'elo', name: 'Elo', type: 'Elo', aliases: [] },
  { id: 'amex', name: 'American Express', type: 'AmericanExpress', aliases: ['amex', 'americanexpress'] },
  { id: 'hipercard', name: 'Hipercard', type: 'Hipercard', aliases: ['hiper card'] },
  { id: 'diners', name: 'Diners Club', type: 'DinersClub', aliases: ['diners', 'dinersclub'] },
  { id: 'maestro', name: 'Maestro', type: 'Maestro', aliases: [] },
];

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function brandByName(name: string): Brand | undefined {
  const n = norm(name);
  if (!n) return undefined;
  return BRANDS.find((brand) => [brand.name, ...brand.aliases].map(norm).some((key) => n === key));
}

export function BrandMark({ name, width = 36 }: { name: string; width?: number }) {
  const brand = brandByName(name);
  if (!brand) return null;
  return <PaymentIcon className="brand-logo" type={brand.type} format="flatRounded" width={width} aria-hidden />;
}

export function BrandPicker({ name, onChange }: { name: string; onChange: (name: string) => void }) {
  const matched = brandByName(name);
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState(() => name.trim() !== '' && !brandByName(name));
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

  const pick = (brand: Brand) => {
    setOther(false);
    setOpen(false);
    onChange(brand.name);
  };

  return (
    <div className="bank-field" ref={ref}>
      <button type="button" className="bank-pick" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {matched ? <BrandMark name={matched.name} width={34} /> : null}
        <span className={matched || other ? undefined : 'ph'}>{matched ? matched.name : other ? 'Outra' : 'Escolher a bandeira'}</span>
        <span className="chev">
          <Icon.right />
        </span>
      </button>
      {open && (
        <div className="bank-list" role="listbox" aria-label="Bandeiras">
          {BRANDS.map((brand) => (
            <button key={brand.id} type="button" role="option" aria-selected={matched?.id === brand.id} className={matched?.id === brand.id ? 'on' : undefined} onClick={() => pick(brand)}>
              <BrandMark name={brand.name} />
              {brand.name}
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
              if (matched) onChange('');
            }}
          >
            <span className="card-logo" style={{ width: 36, height: 24, background: 'var(--line)', color: 'var(--ink)', fontSize: 12 }} aria-hidden>
              +
            </span>
            Outra
          </button>
        </div>
      )}
      {other && <input className="inp" value={matched ? '' : name} onChange={(e) => onChange(e.target.value)} placeholder="Nome da bandeira" autoFocus />}
    </div>
  );
}
