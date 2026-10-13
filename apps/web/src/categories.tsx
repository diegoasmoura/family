import { useState, type ReactNode } from 'react';
import { Icon, Sheet } from './ui';

const p = (d: string) => <path d={d} />;

export const CATEGORY_ICONS: Record<string, { label: string; draw: ReactNode }> = {
  home: { label: 'Casa', draw: p('M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z') },
  key: { label: 'Aluguel', draw: <><circle cx="8" cy="15" r="4" />{p('M11 12l9-9M17 6l3 3M15 8l2 2')}</> },
  building: { label: 'Prédio', draw: p('M4 21V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16M16 9h3a1 1 0 0 1 1 1v11M3 21h18M8 8h4M8 12h4M8 16h4') },
  bolt: { label: 'Energia', draw: p('M13 2L4 14h7l-1 8 9-12h-7z') },
  drop: { label: 'Água', draw: p('M12 3s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12z') },
  wifi: { label: 'Internet', draw: p('M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01') },
  plug: { label: 'Eletrodomésticos', draw: p('M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4') },
  cart: { label: 'Mercado', draw: <>{p('M3 4h2l2.5 11h11L21 7H6.2')}<circle cx="9" cy="19.5" r="1.5" /><circle cx="17" cy="19.5" r="1.5" /></> },
  food: { label: 'Restaurante', draw: p('M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-3 4-3 7h3v11') },
  bus: { label: 'Transporte', draw: p('M5 17V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v11zM5 11h14M8 17v3M16 17v3M8 14h.01M16 14h.01') },
  car: { label: 'Carro', draw: p('M5 16l1.5-5a2 2 0 0 1 2-1.5h7a2 2 0 0 1 2 1.5L19 16M4 16h16v3H4zM7 19v2M17 19v2') },
  fuel: { label: 'Combustível', draw: p('M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 8l3 2v8a1.5 1.5 0 0 0 3 0V9l-3-3') },
  parking: { label: 'Estacionamento', draw: p('M4 4h16v16H4zM9 17V7h4a3 3 0 0 1 0 6H9') },
  shield: { label: 'Seguro', draw: p('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z') },
  wrench: { label: 'Manutenção', draw: p('M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z') },
  doc: { label: 'Contas fixas', draw: p('M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6') },
  phone: { label: 'Telefone', draw: p('M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2') },
  tv: { label: 'Assinaturas', draw: p('M3 6h18v12H3zM8 21h8M12 18v3') },
  heart: { label: 'Saúde', draw: p('M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z') },
  pill: { label: 'Farmácia', draw: p('M10.5 3.5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7zM7 7l7 7') },
  ball: { label: 'Lazer', draw: <><circle cx="12" cy="12" r="9" />{p('M12 3v18M3 12h18M5.6 5.6c3 3 9.8 3 12.8 0M5.6 18.4c3-3 9.8-3 12.8 0')}</> },
  game: { label: 'Games', draw: p('M6 8h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L15 13H9l-1.6 1.8A3 3 0 0 1 2 13v-1a4 4 0 0 1 4-4zM7 10v4M5 12h4M16 11h.01M18 13h.01') },
  plane: { label: 'Viagem', draw: p('M2 13l20-8-8 20-3-9z') },
  shirt: { label: 'Vestuário', draw: p('M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z') },
  book: { label: 'Educação', draw: p('M2 5h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2zM22 5h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z') },
  money: { label: 'Pagamentos', draw: <><circle cx="12" cy="12" r="9" />{p('M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2')}</> },
  briefcase: { label: 'Salário', draw: p('M3 8h18v12H3zM8 8V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3M3 13h18') },
  chart: { label: 'Investimentos', draw: p('M4 20V10M10 20V4M16 20v-7M22 20H2') },
  gift: { label: 'Presentes', draw: p('M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9S10 4 7.5 5 9 9 12 9zM12 9s2-5 4.5-4S15 9 12 9z') },
  paw: { label: 'Pet', draw: <><circle cx="6" cy="11" r="2" /><circle cx="18" cy="11" r="2" /><circle cx="9.5" cy="6" r="2" /><circle cx="14.5" cy="6" r="2" />{p('M12 12c-3 0-5 3.5-5 6 0 1.5 1.5 2 2.5 2s1.5-.5 2.5-.5 1.5.5 2.5.5 2.5-.5 2.5-2c0-2.5-2-6-5-6z')}</> },
  shapes: { label: 'Outros', draw: <>{p('M12 3l4 7H8z')}<circle cx="17" cy="17" r="4" />{p('M3 13h8v8H3z')}</> },
};

export const CATEGORY_COLORS = ['#58CC02', '#FF9600', '#1CB0F6', '#CE82FF', '#FF4B4B', '#FFC800', '#2B70C9', '#FF86D0', '#00B8A9', '#8E9AAF'];

const BY_NAME: [RegExp, string][] = [
  [/morad|casa|lar\b/, 'home'],
  [/aluguel/, 'key'],
  [/condom/, 'building'],
  [/energia|\bluz\b/, 'bolt'],
  [/agua/, 'drop'],
  [/internet|wifi/, 'wifi'],
  [/eletro/, 'plug'],
  [/mercado|supermercado|feira/, 'cart'],
  [/aliment|restaurante|lanche|ifood|comida/, 'food'],
  [/combust|gasolina/, 'fuel'],
  [/estacion/, 'parking'],
  [/ipva|imposto|taxa|fixa/, 'doc'],
  [/seguro/, 'shield'],
  [/manuten|conserto/, 'wrench'],
  [/carro|veiculo/, 'car'],
  [/transporte|uber|onibus/, 'bus'],
  [/telefone|celular/, 'phone'],
  [/assinatura|streaming/, 'tv'],
  [/servico|conta/, 'doc'],
  [/farmac|remedio/, 'pill'],
  [/saude|medic|academia/, 'heart'],
  [/game|jogo/, 'game'],
  [/viage/, 'plane'],
  [/lazer|diversao/, 'ball'],
  [/vestu|roupa/, 'shirt'],
  [/educa|curso|escola/, 'book'],
  [/salario/, 'briefcase'],
  [/pagamento|renda|receita/, 'money'],
  [/invest|rendimento/, 'chart'],
  [/presente|extra|bonus/, 'gift'],
  [/pet|cachorro|gato/, 'paw'],
];

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

type CatLike = { id?: number; name: string; icon?: string | null; color?: string | null; parent_id?: number | null };

/** Ícone salvo, ou um sugerido pelo nome para as categorias que ainda não têm. */
export function iconKey(cat: CatLike) {
  if (cat.icon && CATEGORY_ICONS[cat.icon]) return cat.icon;
  const name = fold(cat.name);
  return BY_NAME.find(([re]) => re.test(name))?.[1] ?? 'shapes';
}

/** Cor da categoria; sem cor, a subcategoria usa a do pai. */
export function categoryColor(cat: CatLike, all: CatLike[] = []) {
  if (cat.color) return cat.color;
  const parent = cat.parent_id != null ? all.find((c) => c.id === cat.parent_id) : undefined;
  if (parent?.color) return parent.color;
  return CATEGORY_COLORS[(cat.id ?? 0) % CATEGORY_COLORS.length];
}

export function IconGlyph({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {(CATEGORY_ICONS[name] ?? CATEGORY_ICONS.shapes).draw}
    </svg>
  );
}

export function CategoryIcon({ cat, all, size = 28 }: { cat: CatLike; all?: CatLike[]; size?: number }) {
  return (
    <span className="cat-ic" style={{ width: size, height: size, background: categoryColor(cat, all) }} aria-hidden>
      <IconGlyph name={iconKey(cat)} />
    </span>
  );
}

type PickerCat = CatLike & { id: number; parent_id: number | null };

/** Categoria e, quando houver, a subcategoria. O valor é o id mais específico escolhido. */
export function CategoryPicker({
  categories = [],
  value,
  onChange,
  onCreate,
  creating,
}: {
  categories?: PickerCat[];
  value: number | null;
  onChange: (id: number | null) => void;
  onCreate?: (name: string, parentId: number | null) => void;
  creating?: boolean;
}) {
  const selected = categories.find((c) => c.id === value);
  const parentId = selected ? (selected.parent_id ?? selected.id) : null;
  const parent = categories.find((c) => c.id === parentId);
  const parents = categories.filter((c) => c.parent_id == null);
  const children = categories.filter((c) => parentId != null && c.parent_id === parentId);
  const sub = selected && selected.parent_id != null ? selected : null;
  const [open, setOpen] = useState<'group' | 'sub' | null>(null);
  const [newName, setNewName] = useState('');
  const creatingSub = open === 'sub';
  const create = () => {
    if (!onCreate || !newName.trim()) return;
    onCreate(newName.trim(), creatingSub ? parentId : null);
    setNewName('');
    setOpen(null);
  };
  const chooseGroup = (id: number) => {
    onChange(id);
    const kids = categories.filter((c) => c.parent_id === id);
    if (kids.length || onCreate) setOpen('sub');
    else setOpen(null);
  };

  const row = (label: string, name: string, cat: CatLike | null, onClick: () => void, disabled = false) => (
    <button type="button" className="pick-row" onClick={onClick} disabled={disabled}>
      {cat ? <CategoryIcon cat={cat} all={categories} size={36} /> : <span className="cat-ic" style={{ width: 36, height: 36, background: 'var(--line)' }} />}
      <span className="grow">
        <small>{label}</small>
        <b>{name}</b>
      </span>
      <Icon.right />
    </button>
  );

  return (
    <>
      <div className="pick-rows">
        {row('Grupo', parent?.name ?? 'Escolher', parent ?? null, () => {
          setNewName('');
          setOpen('group');
        })}
        {row(
          'Subgrupo',
          parent ? (sub?.name ?? 'Geral') : 'Escolha o grupo',
          parent ? (sub ?? { name: 'Geral', icon: 'shapes', color: categoryColor(parent, categories) }) : null,
          () => {
            setNewName('');
            setOpen('sub');
          },
          !parent,
        )}
      </div>
      {open && (
        <Sheet title={open === 'group' ? 'Grupo' : `Subgrupo de ${parent?.name ?? ''}`} onClose={() => setOpen(null)}>
          {open === 'sub' && (
            <button type="button" className="btn ghost sm" onClick={() => setOpen('group')}>
              Voltar aos grupos
            </button>
          )}
          <div className="pick-list" role="listbox" aria-label={open === 'group' ? 'Grupo' : 'Subgrupo'}>
            {open === 'group'
              ? parents.map((c) => (
                  <button key={c.id} type="button" role="option" aria-selected={parentId === c.id} className={`pick-opt${parentId === c.id ? ' on' : ''}`} onClick={() => chooseGroup(c.id)}>
                    <CategoryIcon cat={c} all={categories} size={36} />
                    {c.name}
                  </button>
                ))
              : parent && (
                  <>
                    <button type="button" role="option" aria-selected={value === parent.id} className={`pick-opt${value === parent.id ? ' on' : ''}`} onClick={() => { onChange(parent.id); setOpen(null); }}>
                      <CategoryIcon cat={{ name: 'Geral', icon: 'shapes', color: categoryColor(parent, categories) }} size={36} />
                      Geral
                    </button>
                    {children.map((c) => (
                      <button key={c.id} type="button" role="option" aria-selected={value === c.id} className={`pick-opt${value === c.id ? ' on' : ''}`} onClick={() => { onChange(c.id); setOpen(null); }}>
                        <CategoryIcon cat={c} all={categories} size={36} />
                        {c.name}
                      </button>
                    ))}
                  </>
                )}
          </div>
          {onCreate && (
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <label className="f">
                <span>{creatingSub ? `Novo subgrupo em ${parent?.name}` : 'Novo grupo'}</span>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={40}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      create();
                    }
                  }}
                />
              </label>
              <button type="button" className="btn sm" disabled={!newName.trim() || creating} onClick={create}>
                Criar
              </button>
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}
