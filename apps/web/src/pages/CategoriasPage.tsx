import { useState } from 'react';
import { api, useAction, useApi, type Category } from '../api';
import { inkOn } from '@fin/domain';
import { CATEGORY_COLORS, CATEGORY_ICONS, CategoryIcon, IconGlyph, categoryColor, iconKey } from '../categories';
import { useAppState } from '../state';
import { BackButton, ErrorText, Loading, Seg, Sheet, categoryTree } from '../ui';
import { useConfirm } from '../useConfirm';

function CategoryForm({ kind, category, all, onClose }: { kind: 'income' | 'expense'; category?: Category; all: Category[]; onClose: () => void }) {
  const { toast } = useAppState();
  const parents = all.filter((c) => c.parent_id == null);
  const [name, setName] = useState(category?.name ?? '');
  const [parentId, setParentId] = useState<number | null>(category?.parent_id ?? null);
  const [icon, setIcon] = useState<string | null>(category?.icon ?? null);
  const [color, setColor] = useState<string | null>(category?.color ?? null);
  const preview = { id: category?.id, name: name || 'Categoria', icon, color, parent_id: parentId };
  const shownIcon = iconKey(preview);
  const shownColor = categoryColor(preview, all);
  const save = useAction(
    () => {
      const body = { name, parent_id: parentId, icon: shownIcon, color: color ?? (parentId ? null : shownColor) };
      return category ? api(`/categories/${category.id}`, { method: 'PATCH', body }) : api('/categories', { body: { ...body, kind } });
    },
    () => {
      toast('Categoria salva');
      onClose();
    },
  );
  const remove = useAction(
    () => api(`/categories/${category!.id}`, { method: 'DELETE' }),
    (r: any) => {
      toast(r.archived ? 'Categoria arquivada (tinha uso)' : 'Categoria excluída');
      onClose();
    },
  );
  const { confirm, dialog } = useConfirm();
  return (
    <>
    <Sheet title={category ? 'Editar categoria' : 'Nova categoria'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <div className="row" style={{ gap: 12 }}>
          <CategoryIcon cat={{ name, icon: shownIcon, color: shownColor }} size={44} />
          <label className="f" style={{ flex: 1 }}>
            <span>Nome</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        </div>
        <label className="f">
          <span>Dentro de</span>
          <select value={parentId ?? ''} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Nenhuma (categoria principal)</option>
            {parents
              .filter((p) => p.id !== category?.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <small>Ícone</small>
        <div className="icon-grid" role="radiogroup" aria-label="Ícone">
          {Object.entries(CATEGORY_ICONS).map(([key, { label }]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={shownIcon === key}
              aria-label={label}
              title={label}
              className={shownIcon === key ? 'on' : undefined}
              style={shownIcon === key ? { background: shownColor, color: inkOn(shownColor) } : undefined}
              onClick={() => setIcon(key)}
            >
              <IconGlyph name={key} />
            </button>
          ))}
        </div>
        <small>Cor</small>
        <div className="color-row" role="radiogroup" aria-label="Cor">
          {CATEGORY_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={shownColor === c} aria-label={`Cor ${c}`} className={shownColor === c ? 'on' : undefined} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
        <ErrorText error={save.error ?? remove.error} />
        <button className="btn block" disabled={!name.trim() || save.isPending}>
          Salvar
        </button>
        {category && (
          <button
            type="button"
            className="btn danger block"
            onClick={() =>
              confirm(
                `Excluir “${category.name}”? Se ela já tem lançamentos, orçamento, parcelas, fixas ou subcategorias, será arquivada em vez de apagada.`,
                () => remove.mutate(undefined),
              )
            }
          >
            Excluir ou arquivar
          </button>
        )}
      </form>
    </Sheet>
    {dialog}
    </>
  );
}

export function CategoriasPage() {
  const [kind, setKind] = useState<'income' | 'expense'>('expense');
  const q = useApi<Category[]>(`/categories?kind=${kind}`);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);

  return (
    <main className="page">
      <div className="hd">
        <div className="title-row">
          <BackButton />
          <h1>Categorias</h1>
        </div>
        <button className="btn sm" onClick={() => setEditing('new')}>
          + Categoria
        </button>
      </div>
      <Seg
        label="Tipo"
        value={kind}
        onChange={setKind}
        options={[
          ['expense', 'Despesas'],
          ['income', 'Receitas'],
        ]}
      />
      <ErrorText error={q.error} />
      {!q.data ? (
        <Loading />
      ) : (
        <div className="list">
          {categoryTree(q.data).map((c) => (
            <button key={c.id} className="r" style={{ minHeight: 52, paddingLeft: c.depth ? 28 : 0 }} onClick={() => setEditing(c)}>
              <CategoryIcon cat={c} all={q.data} size={c.depth ? 28 : 34} />
              <div className="m">
                <span className="t" style={{ fontWeight: c.depth ? 700 : 800 }}>
                  {c.name}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
      <small>Nos relatórios, o total da categoria principal soma as subcategorias.</small>
      {editing && <CategoryForm kind={kind} category={editing === 'new' ? undefined : editing} all={q.data ?? []} onClose={() => setEditing(null)} />}
    </main>
  );
}
