# Plano de melhorias · Finanças do casal (mobile-first)

Documento de trabalho com **todas as correções e melhorias sugeridas**, em ordem de execução, com o raciocínio, o código proposto, os critérios de aceite e os arquivos afetados. Foi escrito para uso no celular, que é onde você vai usar o app primeiro.

## 0. Como ler este documento

### Base da análise

Li os seguintes arquivos: `sistema.md`, `HomePage.tsx`, `CartoesPage.tsx`, `AnoPage.tsx` (enviado duas vezes, idêntico), `AuthPage.tsx`, `CalendarioPage.tsx`, `CategoriasPage.tsx`, `ConfigPage.tsx`, `ContasPage.tsx`, `LancamentosPage.tsx`, `LancarPage.tsx`, `MaisPage.tsx`, `MetasPage.tsx`, `OrcamentoPage.tsx`, `PlanosPage.tsx` e `ProgressoPage.tsx`.

### O que eu NÃO vi (e por quê isso importa)

Estes arquivos são importados pelas páginas, mas não foram enviados. Onde um item depende deles, marquei **[depende de X]** e escrevi a mudança como instrução ou como suposição que você precisa conferir.

| Arquivo | Impacto |
|---|---|
| `ui.tsx` (`Sheet`, `Confirm`, `Seg`, `Bar`, `MoneyInput`, `Icon`, `MonthNav`) | Assinaturas de componentes, ícones disponíveis, foco/teclado dos campos |
| `api.ts` (`useApi`, `useAction`, tipos) | Cache, `staleTime`, refetch, `placeholderData` |
| `state.ts`, `people.tsx` | Contexto global, filtro Eu/Nós |
| `TxSheet.tsx`, `TxMenu.tsx` | Endpoint de "marcar pago", enum de `display_status` |
| `categories.tsx` (`CategoryPicker`) | Onde encaixar categorias frequentes |
| CSS global | Todas as classes (`.btn.sm`, `.link`, `.sheet`, `.due-row`...) e variáveis (`--nav-h`, `--neg`, `--warn-text`) |
| Backend / API | Endpoints novos listados na seção G |

### Legenda

- **Prioridade:** `P0` = bug que quebra algo hoje · `P1` = alto impacto no uso diário · `P2` = melhora clara · `P3` = acabamento.
- **Esforço:** `S` ≈ até 1 h · `M` ≈ 1 a 3 h · `L` ≈ mais de 3 h (ou exige backend).
- Trechos `// ANTES` / `// DEPOIS` mostram a troca exata. Trechos soltos são código novo.
- Nomes de classes CSS novas estão em **negrito** na primeira vez; o CSS completo vem junto (seção F1 e dentro de cada item).

### Resumo de todos os itens

| ID | Item | Prio | Esf. | Arquivos |
|---|---|---|---|---|
| **A1** | Ordem dos cards da Home não persiste + reordenar não funciona no toque | P0 | S | `HomePage.tsx` |
| **A2** | Tabela anual volta a rolar para o mês atual ao editar | P0 | S | `AnoPage.tsx` |
| **A3** | Barras zeradas com cor fixa de tema escuro | P1 | S | `HomePage.tsx`, CSS |
| **A4** | Confirmação nas ações destrutivas (hook `useConfirm`) | P0 | M | `useConfirm.tsx` (novo), `CartoesPage`, `ContasPage`, `MetasPage`, `PlanosPage`, `CategoriasPage` |
| **A5** | Tela de Cartões sem `<main>` durante o carregamento | P2 | S | `CartoesPage.tsx` |
| **A6** | Prazo da meta com data mal formatada | P2 | S | `MetasPage.tsx` |
| **A7** | Botão "voltar ao topo" com ícone errado | P3 | S | `HomePage.tsx` |
| **A8** | Linha "Cartões de crédito" sempre zerada no resumo | P3 | S | `LancamentosPage.tsx` |
| **A9** | Limpezas de código (ternários inúteis, ramos idênticos) | P3 | S | `HomePage.tsx` |
| **B1** | Lembrar o último destino (cartão/conta) | P1 | S | `LancarPage.tsx` |
| **B2** | Atalhos de data (Hoje / Ontem / Outra) | P1 | S | `LancarPage.tsx` |
| **B3** | Categorias frequentes como chips | P1 | M | `LancarPage.tsx` + backend |
| **B4** | Sugestão de descrição (autocompletar) | P2 | M | `LancarPage.tsx` + backend |
| **B5** | Botão "Lançar e novo" | P1 | S | `LancarPage.tsx` |
| **B6** | Resumo do destino perto do botão + teclado numérico | P1 | S | `LancarPage.tsx`, `ui.tsx` |
| **C1** | Pagar/abrir direto dos "Próximos vencimentos" | P1 | M | `HomePage.tsx`, `CartoesPage.tsx` |
| **C2** | Reduzir requisições da Home | P1 | M/L | `HomePage.tsx`, `api.ts`, backend |
| **C3** | Skeletons no lugar de "Loading" | P2 | S | `HomePage.tsx`, `ui.tsx`, CSS |
| **C4** | Puxar para atualizar | P2 | M | `usePullToRefresh.ts` (novo) |
| **C5** | Ocultar valores em todo o app | P1 | M | `privacy.ts` (novo), `HomePage`, `MaisPage`, `main.tsx`, CSS |
| **C6** | Ordem padrão da Home + "Restaurar padrão" | P2 | S | `HomePage.tsx` |
| **D1** | Contagem regressiva de fechamento/vencimento | P1 | S | `CartoesPage.tsx` |
| **D2** | "Melhor dia de compra" | P2 | S | `CartoesPage.tsx` |
| **D3** | Tela de pagamento com valor no botão e chip "Valor total" | P2 | S | `CartoesPage.tsx` |
| **D4** | Alerta de limite (80% e 95%) | P2 | S | `CartoesPage.tsx` |
| **D5** | Menu do cartão como folha de baixo | P2 | S | `CartoesPage.tsx` |
| **E1** | Filtro de situação em Lançamentos | P1 | S | `LancamentosPage.tsx` |
| **E2** | Deslizar para trocar de mês | P2 | M | `useSwipe.ts` (novo) + telas |
| **E3** | Calendário: próximos 7 dias e marca de atrasado | P1 | M | `CalendarioPage.tsx`, CSS |
| **E4** | Orçamento: "restam", alerta e projeção | P2 | S | `OrcamentoPage.tsx` |
| **E5** | Metas: depósito rápido, editar, quanto guardar por mês | P2 | M | `MetasPage.tsx` + backend |
| **E6** | Visão anual compacta no celular | P1 | M | `AnoPage.tsx`, CSS |
| **E7** | Senha: mostrar/ocultar e confirmação | P2 | S | `AuthPage.tsx`, `ConfigPage.tsx` |
| **E8** | Mais em seções + exportar dados | P3 | S/M | `MaisPage.tsx` + backend |
| **E9** | Números de Lançamentos que "não fecham" em Eu | P3 | S | `LancamentosPage.tsx` |
| **E10** | Tipagem no lugar de `any` | P3 | M | `types.ts` (novo) + várias |
| **F1** | CSS de toque, safe areas e `dvh` | P1 | S | CSS global |
| **F2** | PWA instalável | P2 | M | `vite.config`, `index.html`, nginx |
| **F3** | Notificações de vencimento (web push) | P2 | L | backend + SW |
| **F4** | `Sheet`: arrastar para fechar, Esc, foco | P2 | M | `ui.tsx` |
| **F5** | Campos de valor com teclado certo | P1 | S | `ui.tsx` |
| **G** | Backend: endpoints e correções | — | — | API |
| **H** | Atualizar `sistema.md` | P3 | S | `sistema.md` |

---

# Fase 1 · Correções (bugs e segurança de toque)

## A1. Ordem dos cards da Home não persiste + reordenar não funciona no toque

**Prioridade P0 · Esforço S · `HomePage.tsx`**

São dois problemas na mesma função/tela.

### A1.1 A ordem salva é ignorada ao recarregar (bug de lógica)

`loadLayout` monta a ordem assim:

```ts
const order = DEFAULT_ORDER.filter((id) => raw.order?.includes(id)).concat(DEFAULT_ORDER.filter((id) => !raw.order?.includes(id)));
```

`DEFAULT_ORDER.filter(...)` percorre a lista **padrão** e só pergunta "este id existe na ordem salva?". Como todos existem, o resultado é sempre a ordem padrão. A ordem que você gravou em `fin-home-layout` nunca é usada. Dentro da sessão parece funcionar porque `saveLayout` atualiza o estado direto; ao recarregar, volta tudo ao padrão. (O `sistema.md` afirma que a ordem "fica gravada neste aparelho". Hoje só os itens ocultos ficam.)

A correção é filtrar a ordem **salva** e depois acrescentar o que for novo:

```ts
// DEPOIS
function loadLayout(): { order: BlockId[]; hidden: BlockId[] } {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
    const saved: BlockId[] = Array.isArray(raw?.order) ? raw.order : [];
    const order = saved
      .filter((id, i) => DEFAULT_ORDER.includes(id) && saved.indexOf(id) === i) // só ids válidos, sem repetir
      .concat(DEFAULT_ORDER.filter((id) => !saved.includes(id)));                // blocos novos entram no fim
    const hidden = (Array.isArray(raw?.hidden) ? raw.hidden : []).filter((id: string) => DEFAULT_ORDER.includes(id as BlockId));
    return { order, hidden };
  } catch {
    return { order: DEFAULT_ORDER, hidden: [] };
  }
}
```

Também envolva as escritas em `localStorage` com `try/catch` (modo privado do Safari pode lançar exceção):

```ts
const saveLayout = (order: BlockId[], hidden: BlockId[]) => {
  const next = { order, hidden };
  setLayout(next);
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch { /* sem persistência, mas não quebra */ }
};
```

### A1.2 Arrastar não funciona com o dedo

A folha "Configurar resumo" usa `draggable`, `onDragStart`, `onDragOver` e `onDrop`. Esses eventos são do HTML5 drag-and-drop de **mouse**; na maioria dos navegadores de celular eles não disparam com o toque. Para o seu caso (celular primeiro), troque por botões **↑** e **↓**. É mais simples e funciona em qualquer lugar.

Remova o estado `dragId` e os handlers de arraste. Adicione:

```tsx
const move = (id: BlockId, dir: -1 | 1) => {
  const order = [...layout.order];
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  saveLayout(order, layout.hidden);
};
```

E a linha da lista fica:

```tsx
{layout.order.map((id, index) => {
  const label = BLOCKS.find(([key]) => key === id)?.[1];
  const off = layout.hidden.includes(id);
  return (
    <div key={id} className={`layout-row${off ? ' off' : ''}`}>
      <span className="layout-name">{label}</span>
      <span className="layout-tools">
        <button type="button" className="mv" aria-label={`Subir ${label}`} disabled={index === 0} onClick={() => move(id, -1)}>↑</button>
        <button type="button" className="mv" aria-label={`Descer ${label}`} disabled={index === layout.order.length - 1} onClick={() => move(id, 1)}>↓</button>
        <button
          type="button"
          className="link"
          onClick={() => saveLayout(layout.order, off ? layout.hidden.filter((item) => item !== id) : [...layout.hidden, id])}
        >
          {off ? 'Mostrar' : 'Ocultar'}
        </button>
      </span>
    </div>
  );
})}
```

Corrija o texto da folha, que fala de "olho":

```tsx
// ANTES
<p className="empty">Arraste para reordenar. O olho oculta o card.</p>
// DEPOIS
<p className="empty">Use as setas para reordenar. “Ocultar” esconde o card da tela inicial.</p>
```

CSS novo (ajuste às suas variáveis):

```css
.layout-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 52px; }
.layout-row.off .layout-name { opacity: .5; text-decoration: line-through; }
.layout-tools { display: inline-flex; align-items: center; gap: 4px; }
.layout-tools .mv { width: 44px; height: 44px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font-size: 18px; font-weight: 700; }
.layout-tools .mv:disabled { opacity: .35; }
.layout-tools .link { min-height: 44px; padding: 0 8px; }
```

**Aceite:** reordenar no celular, fechar o app, reabrir → ordem mantida. Ocultar e mostrar continuam funcionando. Com o primeiro item, "↑" fica desabilitado; com o último, "↓".

---

## A2. Tabela anual volta a rolar para o mês atual ao editar

**Prioridade P0 · Esforço S · `AnoPage.tsx`**

O `useEffect` que centraliza a coluna do mês atual e liga as sombras de rolagem tem `[year, mode, d]` como dependências. Sempre que os dados mudam (por exemplo, você abre um lançamento pelo `AuditSheet`, paga ou edita, e o relatório recarrega), o efeito roda de novo e **joga a rolagem de volta para o mês atual**. Quem estava olhando março é arrancado dali.

Separe em dois efeitos e troque `d` por um booleano estável:

```tsx
const loaded = Boolean(d);

// 1) Centraliza o mês atual: só ao abrir, ou ao trocar de ano/modo.
useEffect(() => {
  const el = scRef.current;
  if (!el) return;
  const col = el.querySelector<HTMLElement>('thead th.cur');
  if (!col) return;
  const stickyW = el.querySelector<HTMLElement>('thead th')?.offsetWidth ?? 0;
  const edge = col.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
  const view = el.clientWidth - stickyW;
  el.scrollLeft = Math.max(0, edge - stickyW - (view - col.offsetWidth) / 2);
}, [year, mode, loaded]);

// 2) Sombras de "tem mais para os lados": observa o tamanho, não os dados.
useEffect(() => {
  const el = scRef.current;
  const wrap = wrapRef.current;
  if (!el || !wrap) return;
  const sync = () => {
    wrap.classList.toggle('scrolled', el.scrollLeft > 4);
    wrap.classList.toggle('more', el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };
  sync();
  el.addEventListener('scroll', sync, { passive: true });
  const ro = new ResizeObserver(sync);
  ro.observe(el);
  const table = el.querySelector('table');
  if (table) ro.observe(table);
  return () => {
    el.removeEventListener('scroll', sync);
    ro.disconnect();
  };
}, [loaded]);
```

Observação: se o seu `useApi` mantiver os dados antigos enquanto carrega o ano novo (`placeholderData`), o efeito 1 roda com a tabela antiga; é inofensivo, e roda de novo se `loaded` alternar.

**Aceite:** abrir Ano, rolar até março, tocar num valor, abrir o lançamento, marcar como pago, fechar → a tabela continua em março. Trocar de ano ou de Realizado/Previsto ainda centraliza o mês atual.

---

## A3. Barras zeradas com cor fixa de tema escuro

**Prioridade P1 · Esforço S · `HomePage.tsx` (`YearBlock`), CSS**

No gráfico "mês a mês", meses sem valor usam `#3a3d42` (cinza muito escuro). No tema claro isso vira uma barra pesada, que parece dado e não "vazio".

```tsx
// ANTES
<Cell key={row.name} fill={row.inc ? "#6fbf8a" : "#3a3d42"} />
<Cell key={row.name} fill={row.exp ? "#e08b84" : "#3a3d42"} />
// DEPOIS
<Cell key={row.name} fill={row.inc ? "#6fbf8a" : "var(--bar-empty)"} />
<Cell key={row.name} fill={row.exp ? "#e08b84" : "var(--bar-empty)"} />
```

CSS (o app já usa `fill="var(--ink)"` em SVG, então variáveis em `fill` funcionam):

```css
:root { --bar-empty: #e6e9ef; }
:root[data-theme="dark"] { --bar-empty: #3a3d42; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bar-empty: #3a3d42; } }
```

Ajuste os seletores ao jeito como o seu `theme.ts` aplica o tema (atributo, classe ou `color-scheme`). **[depende do CSS/theme]**

**Aceite:** nos dois temas, mês sem movimento aparece como um traço discreto.

---

## A4. Confirmação nas ações destrutivas

**Prioridade P0 · Esforço M · vários arquivos**

No celular o toque errado é fácil. Hoje agem **sem confirmação**:

| Ação | Arquivo | Efeito |
|---|---|---|
| Remover pagamento de fatura | `CartoesPage` (`DespesasSheet`) | Não devolve as compras já efetivadas (o `sistema.md` avisa) |
| Remover transferência | `ContasPage` | Muda saldos |
| Arquivar conta | `ContasPage` (`AccountForm`) | Some da lista |
| Excluir meta | `MetasPage` (`DepositSheet`) | Perde o histórico da meta |
| Excluir fixa / Encerrar fixa | `PlanosPage` (`RecurrenceForm`) | Apaga previstos futuros |
| Excluir ou arquivar categoria | `CategoriasPage` | Apaga ou arquiva |

(Cartões já confirma arquivar e excluir; esses estão certos. Parcelamentos também já usa `Confirm`.)

### A4.0 Um hook para evitar repetição

Crie `src/useConfirm.tsx`. Pela forma como você usa `Confirm` (props `text`, `danger`, `onConfirm`, `onClose`), ele não fecha sozinho depois do `onConfirm`, então o hook fecha.

```tsx
import { useState, type ReactNode } from 'react';
import { Confirm } from './ui';

export function useConfirm() {
  const [ask, setAsk] = useState<{ text: string; danger: boolean; run: () => void } | null>(null);

  /** Abre a confirmação. `run` só roda se a pessoa tocar em confirmar. */
  const confirm = (text: string, run: () => void, danger = true) => setAsk({ text, danger, run });

  const dialog: ReactNode = ask ? (
    <Confirm
      danger={ask.danger}
      text={ask.text}
      onConfirm={() => {
        const run = ask.run;
        setAsk(null);
        run();
      }}
      onClose={() => setAsk(null)}
    />
  ) : null;

  return { confirm, dialog };
}
```

> **Cuidado com o lugar do `{dialog}`.** Dentro de uma `Sheet` animada (com `transform`), um elemento `position: fixed` passa a se posicionar em relação à folha e não à tela. Por isso, nos itens abaixo o `dialog` é renderizado **ao lado** da `Sheet` (fragmento `<> ... </>`), não dentro dela. Se o seu `Confirm` já usa portal, não faz diferença. **[depende de `ui.tsx`]**

### A4.1 Remover pagamento de fatura (`CartoesPage.tsx`, `DespesasSheet`)

```tsx
import { useConfirm } from '../useConfirm';

function DespesasSheet({ card, month, onClose, onTx }: { ... }) {
  const { toast } = useAppState();
  const { confirm, dialog } = useConfirm();
  // ...
  return (
    <>
      <Sheet title={`${card.name} · fatura de ${monthName(month)}`} onClose={onClose}>
        {/* ...conteúdo atual... */}
        {inv.payments.map((p: any) => (
          <div className="kv" key={p.id}>
            <span>{shortDate(p.paid_on)} · {p.account_name}</span>
            <span className="row">
              <b className="num">{brl(p.amount_cents)}</b>
              <button
                className="link"
                aria-label="Remover pagamento"
                onClick={() =>
                  confirm(
                    `Remover o pagamento de ${brl(p.amount_cents)} feito em ${shortDate(p.paid_on)}? O valor volta para a conta, mas as compras que ele já efetivou continuam efetivadas.`,
                    () => removePayment.mutate(p.id),
                  )
                }
              >
                remover
              </button>
            </span>
          </div>
        ))}
      </Sheet>
      {dialog}
    </>
  );
}
```

> Confirme a frase "o valor volta para a conta" com o comportamento real da API. Pelo `sistema.md`, remover o pagamento não "devolve as compras já efetivadas"; o texto acima já diz isso.

### A4.2 Remover transferência (`ContasPage.tsx`)

```tsx
const { confirm, dialog } = useConfirm();
// ...
<button
  className="link"
  onClick={() =>
    confirm(
      `Remover a transferência de ${brl(t.amount_cents)} (${t.from_account_name} → ${t.to_account_name})? Os saldos das duas contas voltam ao que eram.`,
      () => removeTransfer.mutate(t.id),
    )
  }
>
  remover
</button>
// ...no fim do <main>:
{dialog}
```

### A4.3 Arquivar conta (`ContasPage.tsx`, `AccountForm`)

`AccountForm` passa a devolver um fragmento com a `Sheet` e o `dialog`:

```tsx
{account && isAdmin && (
  <button
    type="button"
    className="btn danger block"
    onClick={() =>
      confirm(
        `Arquivar ou excluir “${account.name}”? Se a conta já teve movimentos, ela é arquivada e o histórico fica; senão, é apagada.`,
        () => archive.mutate(undefined),
      )
    }
  >
    Arquivar conta
  </button>
)}
```

### A4.4 Excluir meta (`MetasPage.tsx`, `DepositSheet`)

```tsx
<button
  type="button"
  className="btn danger block"
  onClick={() =>
    confirm(`Excluir a meta “${goal.name}”? Você tinha guardado ${brl(goal.saved_cents)} nela.`, () => remove.mutate(undefined))
  }
>
  Excluir meta
</button>
```

Devolva `<>` `<Sheet>…</Sheet>` `{dialog}` `</>`.

### A4.5 Excluir e encerrar fixa (`PlanosPage.tsx`, `RecurrenceForm`)

```tsx
<button
  className="btn ghost"
  onClick={() =>
    confirm(
      `Encerrar “${rec.description}” em ${monthLabel(endMonth).toLowerCase()}? Os previstos depois disso que você não editou à mão serão apagados.`,
      () => end.mutate(undefined),
      false,
    )
  }
  disabled={!endMonth}
>
  Encerrar
</button>

<button
  className="btn danger block"
  onClick={() =>
    confirm(
      `Excluir a fixa “${rec.description}”? Os previstos a partir deste mês somem; o que já aconteceu fica.`,
      () => remove.mutate(undefined),
    )
  }
>
  Excluir fixa
</button>
```

Se preferir, reaproveite o estado `confirm`/`Confirm` que `ParcelamentosPage` já usa; o hook só evita repetir o estado em cada formulário.

### A4.6 Excluir ou arquivar categoria (`CategoriasPage.tsx`)

```tsx
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
```

**Aceite (todos):** tocar no botão abre a confirmação com o nome e o valor envolvidos; "Cancelar" ou tocar fora não executa nada; só "Confirmar" dispara a chamada. Testar no celular, com o teclado aberto e fechado.

---

## A5. Tela de Cartões sem `<main>` durante o carregamento

**Prioridade P2 · Esforço S · `CartoesPage.tsx`**

```tsx
// ANTES
if (cards.isLoading) return <Loading />;
// DEPOIS
if (cards.isLoading) return <main className="page"><Loading /></main>;
```

Sem o `<main className="page">`, o carregamento não recebe a coluna central nem o respiro da barra inferior, e o layout "salta" quando a lista chega.

---

## A6. Prazo da meta com data mal formatada

**Prioridade P2 · Esforço S · `MetasPage.tsx`**

```tsx
// ANTES
até {shortDate(g.deadline)}/{g.deadline.slice(0, 4)}
```

Dependendo do que `shortDate` devolve, isso sai como `15/03/2027` ou como algo estranho tipo `15 mar/2027`. Use um formato único e claro. Helper (pode ir em `ui.tsx` e ser reaproveitado):

```ts
export const fullDate = (iso: string) => iso.split('-').reverse().join('/'); // 2027-03-15 -> 15/03/2027
```

```tsx
// DEPOIS
<small>até {fullDate(g.deadline)}</small>
```

---

## A7. Botão "voltar ao topo" com ícone errado

**Prioridade P3 · Esforço S · `HomePage.tsx`**

O botão usa `Icon.trend` (ícone de tendência). Troque por uma seta para cima inline, sem depender de `Icon`:

```tsx
<button type="button" className="to-top" aria-label="Voltar ao topo" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
</button>
```

Garanta que `.to-top` fique acima da barra inferior: `bottom: calc(var(--nav-h) + 16px + env(safe-area-inset-bottom))`. **[depende do CSS]**

---

## A8. Linha "Cartões de crédito" sempre zerada no resumo

**Prioridade P3 · Esforço S · `LancamentosPage.tsx` (`SummarySheet`)**

O próprio `sistema.md` registra que essa linha fica zerada porque nenhum lançamento recebe o status "cartão". Uma linha que nunca muda confunde. Remova:

```tsx
// ANTES
{!income && row('Cartões de crédito', s.cards)}
// DEPOIS
(apagar a linha)
```

Se um dia quiser mostrar quanto está no cartão, use o total das faturas (`invoices`) e não `situation.cards`.

---

## A9. Limpezas de código

**Prioridade P3 · Esforço S · `HomePage.tsx`**

1. Ternário inútil (as duas pontas são `undefined`):

   ```tsx
   // ANTES
   <Bar ratio={...} kind={d.expense.to_pay_cents > 0 ? undefined : undefined} />
   // DEPOIS
   <Bar ratio={expenseTotal ? d.expense.realized_cents / expenseTotal : 0} />
   ```

2. Ramos idênticos em `childrenOf`:

   ```tsx
   // ANTES
   const color = tx.parent_category_name ? tx.category_color : tx.category_color;
   // DEPOIS
   const color = tx.category_color;
   ```

   (Se a intenção era usar a cor da categoria-pai para o "Geral", o certo seria `tx.parent_category_name ? tx.category_color : tx.parent_category_color ?? tx.category_color`. Decida e deixe só uma expressão.)

3. `const txs = expNow.data?.items ?? []` cria um array novo a cada render quando não há dados, o que invalida o `useMemo` seguinte à toa. Use uma constante vazia estável:

   ```tsx
   const EMPTY: Tx[] = [];
   const txs: Tx[] = expNow.data?.items ?? EMPTY;
   const prevTxs: Tx[] = expPrev.data?.items ?? EMPTY;
   ```

4. Em `ClassifySheet`, o `useApi('/categories?kind=expense')` roda toda vez que a folha abre; se `useApi` tiver `staleTime`, isso já é barato. Só confira.

---

# Fase 2 · Lançar mais rápido (`LancarPage.tsx`)

Esta é a tela que você mais vai usar no celular. Meta: um gasto comum em **menos de 10 segundos** e com poucos toques.

## B1. Lembrar o último destino (cartão ou conta)

**P1 · S**

Hoje, sem escolha, a despesa cai **no primeiro cartão** da lista, sem aviso. Com pressa, isso vira compra no cartão errado. Guarde o último destino usado e use-o como padrão.

```tsx
const LAST_TARGET_KEY = 'fin-last-target';

function readLastTarget(): Target {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_TARGET_KEY) || 'null');
    return v && (v.type === 'card' || v.type === 'account') && Number.isInteger(v.id) ? v : null;
  } catch {
    return null;
  }
}
function rememberTarget(t: NonNullable<Target>) {
  try { localStorage.setItem(LAST_TARGET_KEY, JSON.stringify(t)); } catch { /* ignora */ }
}
```

No `defaultTarget`, valide que o destino lembrado ainda existe (cartão pode ter sido arquivado) e que é compatível com o tipo (receita não vai para cartão):

```tsx
const defaultTarget: Target = useMemo(() => {
  const last = readLastTarget();
  if (last?.type === 'card' && kind === 'expense' && cards.data?.some((c) => c.id === last.id)) return last;
  if (last?.type === 'account' && accounts.data?.accounts.some((a) => a.id === last.id)) return last;
  if (kind === 'expense' && cards.data?.length) return { type: 'card', id: cards.data[0].id };
  if (accounts.data?.accounts.length) return { type: 'account', id: accounts.data.accounts[0].id };
  return null;
}, [kind, cards.data, accounts.data]);
```

E no sucesso do envio:

```tsx
(xp) => {
  if (chosen) rememberTarget(chosen);
  celebrate(xp, kind === 'income' ? 'Receita lançada' : 'Despesa lançada');
  back();
},
```

A prioridade fica: cartão vindo do botão **+** de um cartão (`location.state.cardId`) › último usado › primeiro da lista.

**Aceite:** lançar no Nubank, abrir "Novo lançamento" de novo → Nubank já selecionado. Arquivar o Nubank → cai no primeiro disponível, sem erro.

## B2. Atalhos de data (Hoje / Ontem / Outra)

**P1 · S**

O seletor de data nativo do celular é lento para o caso mais comum (hoje ou ontem). Mantenha o campo, mas ponha chips acima dele.

```tsx
import { addDays, dayOf, invoiceForPurchase, monthOf, splitInstallments } from '@fin/domain';
import { useMemo, useRef, useState, type FormEvent } from 'react';

const yesterday = addDays(today, -1);
const dateRef = useRef<HTMLInputElement>(null);
const openPicker = () => {
  const el = dateRef.current;
  if (!el) return;
  try { el.showPicker(); } catch { el.focus(); }
};
```

```tsx
<div className="chips" role="radiogroup" aria-label="Data rápida">
  <button type="button" role="radio" aria-checked={date === today} className={`chip sm${date === today ? ' on' : ''}`} onClick={() => setDate(today)}>Hoje</button>
  <button type="button" role="radio" aria-checked={date === yesterday} className={`chip sm${date === yesterday ? ' on' : ''}`} onClick={() => setDate(yesterday)}>Ontem</button>
  <button type="button" role="radio" aria-checked={date !== today && date !== yesterday} className={`chip sm${date !== today && date !== yesterday ? ' on' : ''}`} onClick={openPicker}>Outra</button>
</div>
<label className="f" style={{ flex: 'none' }}>
  <span>{/* rótulo atual da data */}</span>
  <input ref={dateRef} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} required />
</label>
```

Em fixa/parcelada os chips servem do mesmo jeito (mudam "Primeira data" / "Data da compra").

## B3. Categorias frequentes como chips

**P1 · M · [depende de `CategoryPicker` e do backend]**

A lista completa de categorias é boa para classificar, mas lenta para o dia a dia. Mostre as 5 mais usadas nos últimos 90 dias, por tipo, acima do `CategoryPicker`.

**Backend (G1):** `GET /categories/frequent?kind=expense` devolve `[{ id, name, parent_id, color, icon }]` ordenado por uso.

```tsx
const frequent = useApi<Category[]>(`/categories/frequent?kind=${kind}`);

{frequent.data && frequent.data.length > 0 && (
  <>
    <small>Mais usadas</small>
    <div className="chips" role="radiogroup" aria-label="Categorias mais usadas">
      {frequent.data.slice(0, 5).map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={categoryId === c.id}
          className={`chip sm${categoryId === c.id ? ' on' : ''}`}
          onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
        >
          {c.name}
        </button>
      ))}
    </div>
  </>
)}
<CategoryPicker ... />
```

Tocar de novo no chip ativo limpa a categoria (categoria é opcional). Sem backend ainda, dá para calcular no cliente com `/transactions` do mês, mas fica mais pesado; prefira o endpoint.

## B4. Sugestão de descrição (autocompletar)

**P2 · M · [backend]**

**Backend (G2):** `GET /transactions/suggestions?kind=expense` devolve as últimas ~30 descrições distintas: `[{ description, category_id }]`.

```tsx
const sugg = useApi<{ description: string; category_id: number | null }[]>(`/transactions/suggestions?kind=${kind}`);

<input
  list="desc-sugg"
  placeholder="Opcional"
  value={description}
  maxLength={120}
  onChange={(e) => {
    const value = e.target.value;
    setDescription(value);
    const match = sugg.data?.find((s) => s.description === value);
    if (match && categoryId == null && match.category_id != null) setCategoryId(match.category_id);
  }}
/>
<datalist id="desc-sugg">
  {sugg.data?.map((s) => <option key={s.description} value={s.description} />)}
</datalist>
```

Escolher "Mercado" preenche a categoria usada da última vez, se você ainda não tiver escolhido uma. Teste no iOS Safari: o `datalist` funciona, mas é discreto.

## B5. Botão "Lançar e novo"

**P1 · S**

Para registrar várias compras seguidas sem voltar e reabrir. O `uuid` precisa mudar a cada envio, senão a API trataria o segundo lançamento como repetição do primeiro (é para isso que o `client_uuid` existe).

```tsx
const [uuid, setUuid] = useState(clientUuid);
const again = useRef(false);

const submit = useAction(
  async () => { /* ...igual ao atual... */ },
  (xp) => {
    if (chosen) rememberTarget(chosen);
    celebrate(xp, kind === 'income' ? 'Receita lançada' : 'Despesa lançada');
    if (again.current) {
      again.current = false;
      setAmount(null);
      setDescription('');
      setCategoryId(null);
      setUuid(clientUuid()); // novo id: outro lançamento
      // mantém: tipo (despesa/receita), modo, destino, data, "de quem"
    } else {
      back();
    }
  },
);

const onSubmit = (e: FormEvent) => {
  e.preventDefault();
  again.current = false;
  submit.mutate(undefined);
};

const canSubmit =
  !!totalCents && !!chosen &&
  !(effectiveMode === 'installment' && (!countOk || installments == null || totalCents < installments)) &&
  !submit.isPending;
```

```tsx
<div className="row" style={{ gap: 8, marginTop: 'auto' }}>
  <button type="submit" className="btn big grow" disabled={!canSubmit}>Lançar</button>
  <button
    type="button"
    className="btn big ghost"
    disabled={!canSubmit}
    onClick={() => {
      again.current = true;
      submit.mutate(undefined, { onError: () => { again.current = false; } });
    }}
  >
    Lançar e novo
  </button>
</div>
```

Se o envio falha, `again` volta a `false` para o próximo toque em "Lançar" normal não se comportar como "e novo".

## B6. Resumo do destino perto do botão + teclado numérico

**P1 · S**

**Resumo do destino.** Logo acima dos botões, uma linha clara de onde o lançamento vai:

```tsx
const targetName =
  chosen?.type === 'card'
    ? cards.data?.find((c) => c.id === chosen.id)?.name
    : chosen?.type === 'account'
      ? accounts.data?.accounts.find((a) => a.id === chosen.id)?.name
      : undefined;

{chosen && targetName && (
  <div className="dest-line">
    <BankMark name={targetName} size={20} />
    <span>
      {kind === 'income' ? 'Entra em ' : 'Sai de '}
      <b>{targetName}</b>
      {chosen.type === 'card' ? ' (cartão)' : ''}
    </span>
  </div>
)}
```

```css
.dest-line { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--muted); }
.dest-line b { color: var(--ink); }
```

**Teclado numérico e foco [`ui.tsx`, F5].** Garanta no `MoneyInput` o atributo `inputMode="numeric"` (como o valor é digitado em centavos com máscara, é o certo; `"decimal"` mostraria vírgula que a máscara ignora). Aceite uma prop `autoFocus` e passe-a em `LancarPage`: `<MoneyInput big autoFocus ... />`. No iOS, `autoFocus` só abre o teclado se a navegação veio de um toque do usuário; teste, pois pode não abrir.

**Safe area do botão.** A folha em tela cheia deve respeitar o recuo inferior do iPhone: `.sheet.full { padding-bottom: calc(16px + env(safe-area-inset-bottom)); }`.

---

# Fase 3 · Home (`HomePage.tsx`)

## C1. Abrir/pagar direto dos "Próximos vencimentos"

**P1 · M · [depende de `TxSheet` e `/transactions/:id`]**

Hoje tocar numa conta leva a Lançamentos (e troca o mês do app), **sem abrir o item**. Para pagar, são mais 3 toques. Melhor: abrir o lançamento ali mesmo, e dar um botão **Pagar** nas faturas.

### C1.1 Conta/receita: abrir a ficha no lugar

O `CalendarioPage` já usa o padrão certo (busca o lançamento por id e abre `TxSheet`). Reaproveite:

```tsx
const [txId, setTxId] = useState<number | null>(null);
const txQ = useApi<Tx>(txId ? `/transactions/${txId}` : null);
// ...
{txQ.data && <TxSheet key={`${txQ.data.id}-${txQ.data.status}`} tx={txQ.data} onClose={() => setTxId(null)} />}
```

> Confirme que, no item de `upcoming` do tipo `tx`, `item.id` é o **id do lançamento**. (No calendário o campo se chama `tx_id`.) Se for outro id, o backend precisa devolver `tx_id`.

### C1.2 Fatura: botão "Pagar" (abre o `PaySheet`)

Mova `PaySheet` para `src/PaySheet.tsx` e exporte-o (evita a Home importar de `CartoesPage`):

```tsx
import { PaySheet } from '../PaySheet';

const [payInvoice, setPayInvoice] = useState<{ card: Card; month: string } | null>(null);
// ...
{payInvoice && <PaySheet card={payInvoice.card} month={payInvoice.month} onClose={() => setPayInvoice(null)} />}
```

### C1.3 Nova marcação da linha

A linha deixa de ser um `<Link>` inteiro (não pode ter botão dentro de link). Vira uma `div` com uma área de toque principal e uma ação:

```tsx
{items.map((item) => {
  const isInvoice = item.type === 'invoice';
  const card = isInvoice ? cards.data?.find((c) => c.id === item.card_id) : undefined;
  return (
    <div key={`${item.type}-${item.id}`} className="due-row">
      {isInvoice ? (
        <Link className="due-hit" to={`/cartoes?card=${item.card_id}&mes=${item.reference_month}`}>
          {/* ícone + título + status + valor (conteúdo atual) */}
        </Link>
      ) : (
        <button type="button" className="due-hit" onClick={() => setTxId(item.id)}>
          {/* ícone + título + status + valor (conteúdo atual) */}
        </button>
      )}
      {isInvoice && card && item.reference_month && (
        <button type="button" className="btn sm" onClick={() => setPayInvoice({ card, month: item.reference_month! })}>
          Pagar
        </button>
      )}
    </div>
  );
})}
```

```css
.due-row { display: flex; align-items: center; gap: 8px; }
.due-hit { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; min-height: 56px; background: none; border: 0; text-align: left; color: inherit; }
.due-row .btn.sm { min-height: 44px; flex: none; }
```

Para contas (não faturas), o "marcar como pago" fica dentro da `TxSheet`. Se quiser um botão **Pagar** direto na linha, preciso do endpoint que o `TxMenu` usa; **[depende de `TxMenu.tsx`]**.

**Aceite:** tocar numa conta → abre a ficha sem sair da Home; tocar em "Pagar" numa fatura → abre o pagamento já com o saldo da fatura; após pagar, a linha some da lista (invalida o cache do dashboard).

## C2. Reduzir requisições da Home

**P1 · M a L · `HomePage.tsx`, `api.ts`, backend**

Ao abrir, a Home dispara cerca de **7 chamadas**: `dashboard`, `budgets`, `cards`, `cards/month/:mes`, duas listas completas de `transactions` (mês atual e anterior, só para desenhar a evolução) e `reports/year`. No 4G isso pesa, e as duas listas de lançamentos são as maiores.

### Opção A (melhor): backend entrega a série pronta

`GET /dashboard` passa a incluir:

```json
"evolution": { "current": [0, 3200, 3200, ...], "previous": [0, 1500, ...] }
```

(acumulado por dia, em centavos, uma posição por dia do mês; no mês atual pode ir até hoje). Replique no servidor **exatamente** a regra do cliente: despesas com `include_in_reports`, data = `due_on || occurred_on`, e a observação de que em Nós o cartão fica de fora desta série.

No cliente:

```tsx
const nowSeries: number[] = d?.evolution?.current ?? [];
const prevSeries: number[] = d?.evolution?.previous ?? [];
```

Some o `useMemo` de `cumulative` e os dois `useApi('/transactions...')`. A lista de lançamentos só é necessária para **abrir categoria** e **classificar**, então carregue sob demanda:

```tsx
const needTxs = catName !== null || classify !== null;
const expNow = useApi(needTxs ? `/transactions?month=${month}&kind=expense&person=${personParam(person)}` : null);
const txs: Tx[] = expNow.data?.items ?? EMPTY;
```

### Opção B (sem mexer no backend): carregar só quando o card aparece na tela

```tsx
// src/useInView.ts
import { useEffect, useState } from 'react';

/** Devolve [refCallback, jaVisto]. Usa ref de função porque o elemento nasce depois do carregamento. */
export function useInView<T extends HTMLElement>(rootMargin = '300px') {
  const [el, setEl] = useState<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!el || seen) return;
    if (!('IntersectionObserver' in window)) { setSeen(true); return; }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setSeen(true); io.disconnect(); }
    }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [el, seen, rootMargin]);
  return [setEl, seen] as const;
}
```

Na Home (todos os hooks antes do `if (!d) return`):

```tsx
const [evoRef, evoSeen] = useInView<HTMLDivElement>();
const [yearRef, yearSeen] = useInView<HTMLDivElement>();
const needTxs = evoSeen || catName !== null || classify !== null;
const expNow  = useApi(needTxs ? `/transactions?month=${month}&kind=expense&person=${personParam(person)}` : null);
const expPrev = useApi(evoSeen ? `/transactions?month=${addMonths(month, -1)}&kind=expense&person=${personParam(person)}` : null);
const yearQ   = useApi(yearSeen ? `/reports/year?year=${year}&mode=planned&person=${personParam(person)}` : null);
```

```tsx
{layout.order.filter((id) => !layout.hidden.includes(id)).map((id) => (
  <div key={id} ref={id === 'evolution' ? evoRef : id === 'year' ? yearRef : undefined}>
    {blocks[id]}
  </div>
))}
```

Quando o card está oculto na configuração, ele nunca entra na tela e a consulta nunca roda (ganho extra).

### Cache e "piscada" ao trocar de mês [`api.ts`]

Se `useApi` usa TanStack Query: defina `staleTime` (ex.: 30 s) e `placeholderData: keepPreviousData` (v5) para que trocar de mês mantenha os números antigos até os novos chegarem, em vez de piscar para "Loading". **[depende de `api.ts`]**

**Aceite:** na aba Rede do navegador (celular emulado), abrir a Home faz no máximo 4 chamadas antes de rolar; rolar até "Evolução" dispara as demais. Trocar de mês não zera a tela.

## C3. Skeletons no lugar de "Loading"

**P2 · S**

Ao abrir sem dados, a Home mostra só "Loading" (e o cabeçalho). Esqueletos dão sensação de app pronto.

```tsx
// ui.tsx (ou onde preferir)
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <section className="card" aria-hidden>
      <div className="skel" style={{ height: 14, width: '38%' }} />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skel" style={{ height: i === 0 ? 34 : 14, width: i === 0 ? '60%' : `${88 - i * 12}%`, marginTop: 10 }} />
      ))}
    </section>
  );
}
```

```css
.skel { background: linear-gradient(90deg, var(--line) 25%, var(--surface) 50%, var(--line) 75%); background-size: 200% 100%; animation: skel 1.2s linear infinite; border-radius: 10px; }
@keyframes skel { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .skel { animation: none; } }
```

Na Home:

```tsx
{!q.error && (<><SkeletonCard lines={4} /><SkeletonCard /><SkeletonCard /></>)}
```

## C4. Puxar para atualizar

**P2 · M · `src/usePullToRefresh.ts`**

Em PWA instalado não há botão de recarregar. Um gesto de puxar resolve. O hook usa refs (e não estado) dentro dos handlers para evitar valores desatualizados.

```ts
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function usePullToRefresh(threshold = 72) {
  const qc = useQueryClient();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      const inSheet = (e.target as HTMLElement).closest('.sheet, .overlay');
      startY.current = window.scrollY <= 0 && !inSheet ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current == null || busyRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      pullRef.current = dy > 0 ? Math.min(dy, threshold * 1.4) : 0;
      setPull(pullRef.current);
    };
    const onEnd = async () => {
      if (startY.current == null) return;
      const hit = pullRef.current >= threshold;
      startY.current = null;
      pullRef.current = 0;
      setPull(0);
      if (!hit || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try { await qc.invalidateQueries(); } finally { busyRef.current = false; setBusy(false); }
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [qc, threshold]);

  return { pull, busy, ready: pull >= threshold };
}
```

Uso na Home (e, se quiser, em Lançamentos/Cartões):

```tsx
const ptr = usePullToRefresh();
// ...no topo do <main>:
<div className={`ptr${ptr.busy ? ' busy' : ''}`} style={{ height: ptr.busy ? 36 : ptr.pull / 2 }} aria-hidden>
  {ptr.busy ? 'Atualizando…' : ptr.ready ? 'Solte para atualizar' : ptr.pull > 8 ? 'Puxe para atualizar' : ''}
</div>
```

```css
.ptr { display: flex; align-items: center; justify-content: center; overflow: hidden; font-size: 12px; font-weight: 600; color: var(--muted); transition: height .15s; }
body { overscroll-behavior-y: contain; } /* evita o "recarregar página" nativo do Chrome Android */
```

## C5. Ocultar valores em todo o app

**P1 · M · `privacy.ts` (novo), `HomePage`, `MaisPage`, `main.tsx`, CSS**

Hoje o olho só existe na Home (`fin-hide-money`), e Lançamentos, Calendário e Ano mostram tudo. Em público, isso falha. A forma mais barata de cobrir **todas** as telas sem editar cada uma é um atributo no `<html>` + CSS de desfoque.

### C5.1 Módulo `src/privacy.ts` (estado global simples)

```ts
import { useSyncExternalStore } from 'react';

const HIDE_KEY = 'fin-hide-money';
const AUTO_KEY = 'fin-hide-auto';
const listeners = new Set<() => void>();

const read = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const write = (key: string, on: boolean) => { try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* ignora */ } };

let hidden = read(HIDE_KEY) || read(AUTO_KEY); // "iniciar oculto" já abre oculto

function apply() { document.documentElement.dataset.hideMoney = hidden ? '1' : '0'; }

export function setHidden(on: boolean) {
  hidden = on;
  write(HIDE_KEY, on);
  apply();
  listeners.forEach((l) => l());
}
export const useHidden = () =>
  useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => hidden);

export const isAutoHide = () => read(AUTO_KEY);
export const setAutoHide = (on: boolean) => write(AUTO_KEY, on);

/** Chamar uma vez em main.tsx. */
export function initPrivacy() {
  apply();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isAutoHide()) setHidden(true); // ao ir para segundo plano, oculta
  });
}
```

### C5.2 Ligar na Home

```tsx
// ANTES
const [hiddenMoney, setHiddenMoney] = useState(() => localStorage.getItem(HIDE_KEY) === "1");
const toggleHide = () => { const next = !hiddenMoney; setHiddenMoney(next); localStorage.setItem(HIDE_KEY, next ? "1" : "0"); };
// DEPOIS
const hiddenMoney = useHidden();
const toggleHide = () => setHidden(!hiddenMoney);
```

O `HiddenMoney.Provider` e o `MoneyText` da Home seguem como estão (mostram `R$ ••••`).

### C5.3 Desfoque nas demais telas (CSS)

```css
html[data-hide-money="1"] :is(.num, .money, .home-balance, .year td + td) {
  filter: blur(7px);
  user-select: none;
}
html[data-hide-money="1"] .recharts-yAxis,
html[data-hide-money="1"] .cchart .ax { visibility: hidden; }
```

Observação: `.num` também aparece em percentuais e contagens (ex.: "42%"); eles serão desfocados também, o que é inofensivo. Se quiser algo mais fino, crie uma classe `.money` só para valores e troque nos componentes. A tabela anual não usa `.num`, por isso o seletor `.year td + td`. **[depende do CSS]**

### C5.4 Controles em Mais

```tsx
const hidden = useHidden();
const [auto, setAuto] = useState(isAutoHide);

<section className="card">
  <b>Privacidade</b>
  <label className="toggle">
    <span>Ocultar valores</span>
    <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
  </label>
  <label className="toggle">
    <span>Ocultar ao sair do app</span>
    <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); setAutoHide(e.target.checked); }} />
  </label>
  <small>Os valores ficam borrados até você tocar no olho da tela inicial.</small>
</section>
```

E chame `initPrivacy()` uma vez em `main.tsx`, antes de renderizar.

**Aceite:** ligar o olho na Home → ir a Lançamentos, Calendário, Ano, Contas, Cartões: valores desfocados. "Ocultar ao sair": trocar de app e voltar → tudo oculto.

## C6. Ordem padrão da Home + "Restaurar padrão"

**P2 · S**

No celular, o mais consultado é: saldo, o que vence e a fatura. Mova "Faturas dos cartões" para logo depois de "Próximos vencimentos" na lista `BLOCKS`:

```ts
const BLOCKS = [
  ["summary", "Resumo"],
  ["upcoming", "Próximos vencimentos"],
  ["invoices", "Faturas dos cartões"],
  ["categories", "Despesas por categoria"],
  ["flow", "Fluxo de caixa"],
  ["evolution", "Evolução das despesas"],
  ["recurrence", "Despesas por recorrência"],
  ["year", "Mês a mês"],
] as const;
```

Como a ordem salva agora é respeitada (A1.1), quem já reordenou não é afetado. Para quem quer voltar ao novo padrão, adicione na folha de configuração:

```tsx
<button type="button" className="btn ghost block" onClick={() => saveLayout(DEFAULT_ORDER, [])}>
  Restaurar padrão
</button>
```

---

# Fase 4 · Cartões (`CartoesPage.tsx`)

## D1. Contagem regressiva de fechamento e vencimento

**P1 · S**

`12/OUT.` obriga a fazer conta de cabeça. Mostre "vence em 3 dias" com cor de alerta quando for ≤ 3.

```tsx
function daysUntil(iso: string, today: string) {
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}
const when = (n: number) => (n < 0 ? `há ${-n} d` : n === 0 ? 'hoje' : n === 1 ? 'amanhã' : `em ${n} dias`);
```

Dentro de `CardBlock` (`const { today } = useAppState();`), abaixo de cada data:

```tsx
const closeIn = invoice && invoice.state === 'open' ? daysUntil(invoice.closing_date, today) : null;
const dueIn = invoice && invoice.state !== 'paid' && invoice.state !== 'future' ? daysUntil(invoice.due_date, today) : null;

<div style={{ textAlign: 'center' }}>
  <small>Fechamento</small>
  <b className="num">{invoice ? dayMonth(invoice.closing_date) : '–'}</b>
  {closeIn != null && closeIn >= 0 && <small className={closeIn <= 3 ? 'soon' : undefined}>{when(closeIn)}</small>}
</div>
<div className="right">
  <small>Vencimento</small>
  <b className="num">{invoice ? dayMonth(invoice.due_date) : '–'}</b>
  {dueIn != null && <small className={dueIn < 0 ? 'late' : dueIn <= 3 ? 'soon' : undefined}>{when(dueIn)}</small>}
</div>
```

As classes `.soon` (âmbar) e `.late` (vermelho) já existem na Home; reaproveite. **[depende do CSS]**

## D2. "Melhor dia de compra"

**P2 · S**

Pelas regras do `sistema.md`: compra **no dia do fechamento ou depois** entra na fatura seguinte. Logo, o melhor dia para comprar (maior prazo para pagar) é o **próprio dia do fechamento**.

```tsx
<small className="best-day">
  Melhor dia de compra: dia {card.closing_day}
  {card.closing_day > 28 ? ' (ou o último do mês)' : ''}
</small>
```

Coloque abaixo da linha Conta / Fechamento / Vencimento. Em meses curtos, fechamento 29–31 vira o último dia.

## D3. Tela de pagamento: valor no botão e chip "Valor total"

**P2 · S**

> **Ajuste em relação ao que eu disse antes:** sugeri um "pagar tudo com um toque", mas o `PaySheet` já abre com o saldo da fatura preenchido (`value = amount ?? remaining_cents`). O que falta é deixar **claro o valor** no botão e permitir voltar ao total depois de editar.

```tsx
{amount != null && inv && amount !== inv.remaining_cents && inv.remaining_cents > 0 && (
  <button type="button" className="chip sm" onClick={() => setAmount(null)}>
    Valor total ({brl(inv.remaining_cents)})
  </button>
)}

<button className="btn big" disabled={!value || !chosenAccount || pay.isPending}>
  {value ? `Pagar ${brl(value)}` : 'Registrar pagamento'}
</button>
```

O botão passa a exigir também uma conta escolhida (`chosenAccount`), evitando enviar sem conta.

## D4. Alerta de limite

**P2 · S**

A barra de uso do limite fica na cor do cartão em qualquer nível. Avise quando está acabando:

```tsx
const level = pct >= 95 ? 'crit' : pct >= 80 ? 'warn' : 'ok';
const barColor = level === 'crit' ? 'var(--neg)' : level === 'warn' ? 'var(--warn-text)' : cardColor(card);

<i style={{ width: `${Math.min(100, pct)}%`, background: barColor }} />
...
{level !== 'ok' && (
  <small className={level === 'crit' ? 'late' : 'soon'}>
    {level === 'crit' ? 'Limite quase no fim' : 'Mais de 80% do limite usado'}
  </small>
)}
```

## D5. Menu do cartão como folha de baixo

**P2 · S**

O menu ⋮ tem 8 itens num dropdown. No celular ele pode vazar da tela e o fechamento ao tocar fora depende de `mousedown`. Uma folha de baixo (você já tem `Sheet`) resolve os dois e dá alvos de toque grandes.

```tsx
const ACTIONS: [Panel, string, boolean?][] = [
  ['editar', 'Editar cartão'],
  ['reajustar', 'Reajustar fatura'],
  ['historico', 'Histórico de faturas'],
  ['despesas', 'Despesas associadas'],
  ['categorias', 'Gráfico por categorias'],
  ['evolucao', 'Evolução mensal'],
  ['arquivar', 'Arquivar'],
  ['excluir', 'Excluir', true],
];

function CardMenu({ name, onPick }: { name: string; onPick: (p: Panel) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="kebab" aria-label="Mais ações do cartão" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <Icon.kebab />
      </button>
      {open && (
        <Sheet title={name} onClose={() => setOpen(false)}>
          <div className="list">
            {ACTIONS.map(([panel, label, danger]) => (
              <button
                key={panel}
                type="button"
                className={`r${danger ? ' danger' : ''}`}
                style={{ minHeight: 52 }}
                onClick={() => { setOpen(false); onPick(panel); }}
              >
                <div className="m"><span className="t">{label}</span></div>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
```

Remova o `useEffect` com `mousedown`/`keydown` e o `ref`. Passe `name={card.name}` ao usar. O fechamento por Esc e por toque fora passa a ser responsabilidade da `Sheet` (F4).

---

# Fase 5 · Demais telas

## E1. Filtro de situação em Lançamentos

**P1 · S · `LancamentosPage.tsx`**

Hoje só existe busca por texto. A pergunta mais comum é "o que ainda falta pagar?". Adicione um seletor de situação com a mesma faixa `Seg` que o app já usa.

```tsx
type Situation = 'all' | 'pending' | 'overdue' | 'paid';
const [situation, setSituation] = useState<Situation>('all');

const matchTx = (t: Tx) =>
  situation === 'all' ||
  (situation === 'paid' ? t.display_status === 'paid'
    : situation === 'overdue' ? t.display_status === 'overdue'
    : t.display_status !== 'paid');

const matchInvoice = (inv: InvoiceRow) =>
  situation === 'all' ||
  (situation === 'paid' ? inv.state === 'paid'
    : situation === 'overdue' ? inv.state === 'overdue'
    : inv.state !== 'paid');
```

Aplique no `items` (depois da busca) e nas faturas:

```tsx
const items = useMemo(() => {
  const list: Tx[] = q.data?.items ?? [];
  const searched = !search ? list : list.filter(/* filtro atual */);
  return searched.filter(matchTx);
}, [q.data, search, situation]);

const invoices: InvoiceRow[] = income ? [] : (q.data?.invoices ?? []).filter(matchInvoice);
```

Seletor (rótulos mudam entre despesas e receitas):

```tsx
<Seg
  label="Situação"
  value={situation}
  onChange={setSituation}
  options={[
    ['all', 'Todos'],
    ['pending', income ? 'A receber' : 'A pagar'],
    ['overdue', 'Vencidos'],
    ['paid', income ? 'Recebidos' : 'Pagos'],
  ]}
/>
```

> **Suposição a conferir [`TxSheet`/`ui.tsx`]:** que `display_status` vale `'paid' | 'overdue' | 'soon' | 'planned'` (o `sistema.md` descreve Pago, Atrasado, Próximo, Previsto). O filtro "A pagar" usa `!== 'paid'`, então cobre `soon` e `planned` sem precisar saber os nomes exatos.

Ajuste a mensagem vazia para "Nada nesta situação." quando `situation !== 'all'`. Zere o filtro ao trocar Despesas/Receitas.

## E2. Deslizar para trocar de mês

**P2 · M · `src/useSwipe.ts` + telas**

Toque nas setas do `MonthNav` é preciso, mas deslizar o dedo é natural no celular. O hook ignora gestos que começam em áreas que já rolam na horizontal (tabela anual, gráficos), em campos, dentro de folhas e na borda esquerda (gesto "voltar" do iOS).

```ts
import { useRef, type TouchEvent } from 'react';

const IGNORE = '.sc, .year-scroll, .recharts-wrapper, input, select, textarea, [role="slider"], .sheet, .overlay';

export function useSwipe(onPrev: () => void, onNext: () => void) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const p = e.touches[0];
      const blocked = (e.target as HTMLElement).closest(IGNORE) || p.clientX < 24;
      start.current = blocked ? null : { x: p.clientX, y: p.clientY, t: Date.now() };
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const p = e.changedTouches[0];
      const dx = p.clientX - s.x;
      const dy = p.clientY - s.y;
      if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.8 || Date.now() - s.t > 600) return;
      if (dx < 0) onNext(); else onPrev();
    },
  };
}
```

Uso (Lançamentos, Calendário, Contas, Cartões, Orçamento):

```tsx
const swipe = useSwipe(() => setMonth(addMonths(month, -1)), () => setMonth(addMonths(month, 1)));
<main className="page lanc" {...swipe}>
```

Em **Cartões** o mês vive na URL, então use `setMonth` local (que faz `setParams({ mes })`). Não aplique no **Ano** (as setas ali trocam o ano e a tabela já rola de lado).

## E3. Calendário: próximos 7 dias e marca de atrasado

**P1 · M · `CalendarioPage.tsx`**

Hoje é preciso tocar dia por dia. Acrescente uma lista "Próximos 7 dias" e uma marca vermelha nos dias com algo atrasado.

```tsx
import { addDays, daysInMonth } from '@fin/domain';

const items = data?.items ?? [];
const late = new Set(items.filter((i) => i.status === 'planned' && i.day < today).map((i) => i.day));
const soon = month === today.slice(0, 7)
  ? items
      .filter((i) => i.status === 'planned' && i.day >= today && i.day <= addDays(today, 7))
      .sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key))
  : [];
```

Marca no dia:

```tsx
className={`cal-day${date === today ? ' today' : ''}${late.has(date) ? ' late' : ''}`}
```

Lista abaixo da grade:

```tsx
{soon.length > 0 && (
  <section className="card">
    <h2>Próximos 7 dias</h2>
    <div className="list">
      {soon.map((item) => (
        <button key={item.key} type="button" className="r" style={{ minHeight: 52 }} onClick={() => setDay(item.day)}>
          <i className="cal-who" style={{ background: colorOf(item) }} />
          <div className="m">
            <span className="t">{item.description}</span>
            <small>{dayLabel(item.day)} · {labelOf(item)}</small>
          </div>
          <b className={`num${item.kind === 'income' ? ' pos' : ''}`}>{brl(item.amount_cents)}</b>
        </button>
      ))}
    </div>
  </section>
)}
```

```css
.cal-day.late::after { content: ''; position: absolute; top: 4px; right: 4px; width: 7px; height: 7px; border-radius: 50%; background: var(--neg); }
.cal-day { position: relative; }
```

**Limitação:** a API devolve só o mês visto, então no fim do mês a lista "7 dias" não inclui o mês seguinte. Se isso incomodar, reaproveite `dashboard.upcoming` (30 dias, já resolvido) ou busque os dois meses.

## E4. Orçamento: "restam", alerta e projeção

**P2 · S · `OrcamentoPage.tsx`**

Mostre quanto **resta** (mais útil que só o percentual), alerta a partir de 80% e uma estimativa de fechamento do mês.

Na linha de cada categoria:

```tsx
const remaining = i.planned_cents != null ? i.planned_cents - i.spent_cents : null;
const tone = ratio >= 1 ? 'var(--neg)' : ratio >= 0.8 ? 'var(--warn-text)' : 'currentColor';

{i.planned_cents != null && (
  <span className="mini-bar" style={{ color: tone }}>
    <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
  </span>
)}
...
<div className="v num">
  {brl(i.spent_cents)}
  <small>
    {remaining == null ? 'sem orçamento' : remaining >= 0 ? `restam ${brl(remaining)}` : `estourou ${brl(-remaining)}`}
  </small>
</div>
```

(`mini-bar` é a mesma classe usada na Home, com a cor vinda de `currentColor`. Se preferir manter o componente `Bar`, adicione o tipo `warn` em `ui.tsx`.)

Projeção no card do topo, só para o mês corrente:

```tsx
const { month, setMonth, toast, today } = useAppState();
const isCurrent = month === today.slice(0, 7);
const dayN = Number(today.slice(8, 10));
const projected = isCurrent && dayN > 0 ? Math.round((q.data.spent_cents / dayN) * daysInMonth(month)) : null;

{projected != null && q.data.planned_cents > 0 && (
  <small className={projected > q.data.planned_cents ? 'late' : undefined}>
    No ritmo atual, fecha em {brl(projected)} (orçado {brl(q.data.planned_cents)}). Estimativa simples.
  </small>
)}
```

O ritmo linear é grosseiro (contas fixas pesam no começo do mês), por isso o rótulo "estimativa".

## E5. Metas: depósito rápido, editar e quanto guardar por mês

**P2 · M · `MetasPage.tsx` [editar depende de backend]**

### Depósito rápido

```tsx
const QUICK = [5_000, 10_000, 20_000, 50_000];
const missing = Math.max(0, goal.target_cents - goal.saved_cents);

<div className="chips" aria-label="Valores rápidos">
  {QUICK.map((v) => (
    <button key={v} type="button" className="chip sm" onClick={() => setAmount((a) => (a ?? 0) + v)}>+{brl(v)}</button>
  ))}
  {!withdraw && missing > 0 && (
    <button type="button" className="chip sm" onClick={() => setAmount(missing)}>Completar ({brl(missing)})</button>
  )}
  <button type="button" className="chip sm" onClick={() => setAmount(null)}>Limpar</button>
</div>
```

### Quanto guardar por mês

```tsx
function monthsUntil(deadline: string, today: string) {
  const [y1, m1] = today.split('-').map(Number);
  const [y2, m2] = deadline.split('-').map(Number);
  return Math.max(1, (y2 - y1) * 12 + (m2 - m1) + 1); // conta o mês atual
}

const left = g.target_cents - g.saved_cents;
const perMonth = g.deadline && left > 0 && g.deadline >= today ? Math.ceil(left / monthsUntil(g.deadline, today)) : null;

{g.deadline && left > 0 && (
  <small>{g.deadline < today ? 'Prazo vencido' : `Guarde ${brl(perMonth!)} por mês`}</small>
)}
```

### Editar meta

Hoje só dá para criar e excluir. Faça `GoalForm` aceitar uma meta (mesmo padrão de `AccountForm`):

```tsx
function GoalForm({ goal, onClose }: { goal?: any; onClose: () => void }) {
  const [form, setForm] = useState({
    name: goal?.name ?? '',
    target_cents: (goal?.target_cents ?? null) as number | null,
    saved_cents: (goal?.saved_cents ?? null) as number | null,
    deadline: goal?.deadline ?? '',
  });
  const save = useAction(
    () => {
      const body = { name: form.name, target_cents: form.target_cents, deadline: form.deadline || null, ...(goal ? {} : { saved_cents: form.saved_cents ?? 0 }) };
      return goal ? api(`/goals/${goal.id}`, { method: 'PATCH', body }) : api('/goals', { body });
    },
    () => { toast(goal ? 'Meta atualizada' : 'Meta criada'); onClose(); },
  );
  // esconda o campo "Já guardado" quando goal existir: o valor guardado muda só por depósito/retirada
}
```

E um botão "Editar" dentro de `DepositSheet`. **O endpoint `PATCH /goals/:id` precisa existir (G3).** Atenção às regras do `sistema.md`: mudar o alvo pode concluir ou reabrir a meta; o backend deve aplicar a mesma regra do depósito (conclui e dá 100 XP uma vez).

## E6. Visão anual compacta no celular

**P1 · M · `AnoPage.tsx`, CSS**

Uma tabela de 14 colunas funciona, mas é cansativa no telefone. Abra por padrão numa visão de **um mês + total**, com botão para ver todos.

```tsx
const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches);
const [focus, setFocus] = useState<number | null>(null);
const focusIdx = focus ?? (currentIdx >= 0 ? currentIdx : 0);
const show = (i: number) => !compact || i === focusIdx;
const cols = (compact ? 1 : 12) + 2; // categoria + meses visíveis + total
```

Cabeçalho da tabela e células:

```tsx
{MONTHS_SHORT_PT.map((m, i) => show(i) && <th key={m} className={cls(i)}>{m}</th>)}
...
{months.map((v, i) => show(i) ? (
  <td key={i} className={[cls(i), tone(v, paidMonths?.[i], neg && v < 0)].filter(Boolean).join(' ') || undefined}>
    {value(v, filter, i + 1)}
  </td>
) : null)}
```

Troque `colSpan={14}` por `colSpan={cols}` nas linhas de seção e de "Sem receitas/despesas".

Controles acima da tabela:

```tsx
<div className="row" style={{ justifyContent: 'space-between' }}>
  {compact && (
    <div className="row" style={{ gap: 4 }}>
      <button className="ic" aria-label="Mês anterior" disabled={focusIdx === 0} onClick={() => setFocus(focusIdx - 1)}><Icon.left /></button>
      <b>{MONTHS_LONG[focusIdx]}</b>
      <button className="ic" aria-label="Próximo mês" disabled={focusIdx === 11} onClick={() => setFocus(focusIdx + 1)}><Icon.right /></button>
    </div>
  )}
  <button className="btn sm ghost" onClick={() => setCompact((c) => !c)}>
    {compact ? 'Ver todos os meses' : 'Ver um mês'}
  </button>
</div>
```

No efeito 1 do **A2**, pule a centralização quando `compact` (não há rolagem horizontal). Ao trocar de ano, `setFocus(null)`.

```css
@media (max-width: 639px) { table.year { min-width: 0; width: 100%; } }
```

**Aceite:** no celular, a Visão anual abre com categoria, o mês atual e o total, sem rolar de lado; "Ver todos os meses" volta à tabela completa.

## E7. Senha: mostrar/ocultar e confirmação

**P2 · S · `AuthPage.tsx`, `ConfigPage.tsx`**

Digitar senha no celular erra muito. Dois ajustes: olho para mostrar e campo de confirmação onde a senha é **criada**.

```tsx
// AuthPage.tsx
import { ErrorText, Icon, Seg } from '../ui';

const [show, setShow] = useState(false);
const [confirmPw, setConfirmPw] = useState('');
const mismatch = mode === 'register' && confirmPw !== '' && confirmPw !== form.password;

<label className="f">
  <span>Senha</span>
  <span className="pw">
    <input type={show ? 'text' : 'password'} value={form.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 8 : undefined} required />
    <button type="button" className="ic" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={show} onClick={() => setShow((s) => !s)}>
      {show ? <Icon.eyeOff /> : <Icon.eye />}
    </button>
  </span>
</label>
{mode === 'register' && (
  <label className="f">
    <span>Repita a senha</span>
    <input type={show ? 'text' : 'password'} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" required />
  </label>
)}
{mismatch && <p className="err">As senhas não conferem.</p>}
<button className="btn big" disabled={action.isPending || mismatch}>…</button>
```

```css
.pw { display: flex; align-items: center; gap: 4px; }
.pw input { flex: 1; }
```

Na troca de senha (`ConfigPage`) e em "Senha inicial/Nova senha" do administrador, o mesmo olho. Na troca de senha própria, acrescente "Repita a nova senha" e bloqueie o botão se diferirem. (Para a senha **de outra pessoa** redefinida pelo admin, a confirmação é opcional.)

## E8. Mais em seções + exportar dados

**P3 · S/M · `MaisPage.tsx` [exportar depende de backend]**

Oito links soltos ficam mais fáceis de achar agrupados:

```tsx
const SECTIONS: { title: string; links: [string, string, string][] }[] = [
  { title: 'Planejamento', links: [
    ['/orcamento', 'Orçamento', 'Planejado por categoria no mês'],
    ['/metas', 'Metas', 'Objetivos de economia'],
    ['/recorrencias', 'Fixas', 'Receitas e despesas que se repetem'],
    ['/parcelamentos', 'Parcelamentos', 'Compras parceladas em conta ou cartão'],
  ]},
  { title: 'Cadastros', links: [
    ['/contas', 'Contas e transferências', 'Saldos, saldo inicial e transferências'],
    ['/categorias', 'Categorias', 'Categorias e subcategorias'],
  ]},
  { title: 'Casa', links: [
    ['/progresso', 'Avatar', 'Nível, XP e itens do seu avatar'],
    ['/config', 'Casa e usuários', 'Membros, fuso horário e acesso'],
  ]},
];

{SECTIONS.map((s) => (
  <section key={s.title} className="stack" style={{ gap: 6 }}>
    <h2>{s.title}</h2>
    <div className="list">
      {s.links.map(([to, title, sub]) => (/* o mesmo <Link className="r"> de hoje */))}
    </div>
  </section>
))}
```

**Exportar dados:** um link de download em Mais (G4). O app usa cookie de sessão, então um `<a>` simples basta:

```tsx
<a className="btn ghost block" href="/api/export/transactions.csv" download>Exportar lançamentos (CSV)</a>
```

(Confirme o prefixo real da API; o helper `api()` deve usar algum, como `/api`.)

## E9. Números de Lançamentos que "não fecham" em Eu

**P3 · S · `LancamentosPage.tsx`**

O `sistema.md` documenta: em **Eu**, compra de cartão entra em "Despesas", mas não em "Pago" nem em "A pagar", então os três números não somam. Não é bug, mas confunde. Acrescente uma nota discreta, só em Eu e só em despesas:

```tsx
{!income && person !== 'all' && (
  <small>No modo Eu, compras no cartão contam em “Despesas”, mas só aparecem em “Pago/A pagar” quando a fatura é paga (veja em Cartões).</small>
)}
```

(Confirme o nome do valor de "Nós" em `PersonScope`; no código da Home o teste é `person === "all"`.)

## E10. Tipagem no lugar de `any`

**P3 · M · `src/types.ts` + várias páginas**

Há `any` em Metas, Orçamento, Planos, Contas (transferências), Config (usuários) e no `dashboard` da Home. Interfaces simples já evitam erros de digitação em campos. Inferidas do uso atual (**confira contra o que a API devolve**):

```ts
export interface Goal {
  id: number; name: string; target_cents: number; saved_cents: number;
  deadline: string | null; completed_at: string | null; progress: number;
}
export interface BudgetItem {
  category_id: number; name: string; parent_id: number | null;
  budget_id: number | null; planned_cents: number | null; spent_cents: number;
}
export interface Recurrence {
  id: number; kind: 'income' | 'expense'; description: string; amount_cents: number;
  day_of_month: number; start_month: string; end_month: string | null; active: boolean;
  account_name: string | null; card_name: string | null;
}
export interface InstallmentPlan {
  id: number; description: string; total_cents: number; installments: number;
  settled_count: number; active_count: number; remaining_cents: number;
  purchased_on: string; card_name: string | null; account_name: string | null;
}
export interface Transfer {
  id: number; occurred_on: string; amount_cents: number;
  from_account_name: string; to_account_name: string;
}
export interface HouseUser { id: number; name: string; email: string; role: 'admin' | 'member'; }
```

Troque `useApi<any[]>('/goals')` por `useApi<Goal[]>('/goals')` e assim por diante. Comece pelas telas pequenas (Metas, Planos) e deixe o `dashboard` por último.

---

# Fase 6 · Plataforma (celular de verdade)

## F1. CSS de toque, safe areas e `dvh`

**P1 · S · CSS global [depende do seu CSS atual]**

Estas regras resolvem vários incômodos típicos de PWA/web no celular. Ajuste nomes aos seus seletores.

```css
/* viewport: no index.html use <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"> */

:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --nav-h: calc(76px + var(--safe-bottom));   /* barra inferior acima da "barra home" do iPhone */
}
.tabbar { padding-bottom: var(--safe-bottom); }
.sheet, .overlay { max-height: 100dvh; }        /* dvh acompanha a barra do navegador */
.sheet.full { min-height: 100dvh; padding-bottom: calc(16px + var(--safe-bottom)); }

/* evita o zoom automático do iOS ao focar campos (< 16px) */
input, select, textarea { font-size: 16px; }

/* toque: sem atraso e sem realce cinza */
button, a, .r, .chip { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }

/* alvos de toque de no mínimo 44px */
.btn.sm, .link, .kebab, .ic, .chip.sm { min-height: 44px; }
.link { display: inline-flex; align-items: center; padding: 0 8px; }
.btn.sm, .chip.sm { padding-inline: 14px; }
.kebab, .ic { min-width: 44px; }

body { overscroll-behavior-y: contain; }
```

Os pontos mais críticos são: `link` "Corrigir" em Contas, `remover` em transferências/pagamentos e os botões `sm`, hoje pequenos demais para um dedo.

## F2. PWA instalável

**P2 · M · `vite.config.ts`, `index.html`, nginx**

> **Pré-requisito importante (do seu `sistema.md`):** service worker, "instalar na tela inicial" e passkey exigem **HTTPS com nome** (ou `localhost`). Em `http://IP:3003` o celular **não** instala nem registra service worker. Resolva isso primeiro com Tailscale (MagicDNS + HTTPS) ou um túnel, como você já descreveu para a digital.

### F2.1 Manifesto e plugin

```bash
npm i -D vite-plugin-pwa
```

```ts
// vite.config.ts
import { VitePWA } from 'vite-plugin-pwa';

VitePWA({
  registerType: 'autoUpdate',
  manifest: {
    name: 'Finanças do casal',
    short_name: 'Finanças',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#1f9d6b', // use a cor principal do seu app
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/api\//],
    runtimeCaching: [], // NÃO cachear /api: são dados financeiros e a sessão é por cookie
  },
});
```

### F2.2 `index.html`

```html
<meta name="theme-color" content="#1f9d6b" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121417" media="(prefers-color-scheme: dark)">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
```

### F2.3 nginx (container do site)

O arquivo do service worker nunca pode ficar em cache longo, senão o app não atualiza:

```nginx
location = /sw.js { add_header Cache-Control "no-cache"; }
location = /index.html { add_header Cache-Control "no-cache"; }
location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
```

### Offline

Com `runtimeCaching` vazio, offline abre a "casca" do app e as consultas falham. Mostre uma faixa "Sem conexão" (`navigator.onLine` + eventos `online`/`offline`) e desabilite "Lançar". Cachear dados financeiros offline exige cuidado (outra pessoa pegando o celular); deixe para depois, se quiser.

## F3. Notificações de vencimento (web push)

**P2 · L · backend + service worker**

Útil para "fatura vence amanhã" e "conta vence hoje". Exige HTTPS e, no iPhone, o app **instalado na tela inicial** (iOS 16.4+).

1. **Chaves VAPID:** `npx web-push generate-vapid-keys`; guarde em variáveis de ambiente (`VAPID_PUBLIC`, `VAPID_PRIVATE`, `VAPID_SUBJECT=mailto:...`).
2. **Tabela** `push_subscriptions(id, user_id, endpoint UNIQUE, p256dh, auth, created_at)`.
3. **Endpoints:** `POST /push/subscribe` (salva), `DELETE /push/subscribe` (remove), `GET /push/key` (chave pública).
4. **Cliente (botão em Mais ou Config):**

   ```ts
   const reg = await navigator.serviceWorker.ready;
   const { key } = await api('/push/key');
   const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
   await api('/push/subscribe', { body: sub.toJSON() });
   ```
5. **Service worker** (modo `injectManifest` do vite-plugin-pwa ou `importScripts`):

   ```js
   self.addEventListener('push', (e) => {
     const data = e.data?.json() ?? {};
     e.waitUntil(self.registration.showNotification(data.title ?? 'Finanças', { body: data.body, icon: '/icons/icon-192.png', data: { url: data.url ?? '/' } }));
   });
   self.addEventListener('notificationclick', (e) => {
     e.notification.close();
     e.waitUntil(clients.openWindow(e.notification.data.url));
   });
   ```
6. **Agendamento no servidor:** uma tarefa diária (por exemplo às 8h no fuso da casa; o app já guarda `timezone` da casa) que busca vencimentos de hoje/amanhã e faturas em aberto e envia com a lib `web-push`. Remova a inscrição quando o push service responder 404/410.
7. **Privacidade:** a notificação deve evitar valores por padrão ("Fatura do Nubank vence amanhã"), já que aparece na tela bloqueada. Ofereça opção para incluir o valor.

## F4. `Sheet`: arrastar para fechar, Esc e foco

**P2 · M · `ui.tsx` [depende do arquivo]**

Como quase toda a edição acontece em folhas, vale deixar a `Sheet` boa de usar:

- Fechar com **Esc** e ao tocar no fundo.
- **Arrastar para baixo** pela alça/cabeçalho para fechar (limite ~80 px ou velocidade alta).
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` no título.
- **Foco**: ao abrir, focar o primeiro campo (ou o botão de fechar); prender o Tab dentro; devolver o foco ao elemento que abriu.
- **Bloquear a rolagem do fundo**: `document.body.style.overflow = 'hidden'` enquanto aberta (restaurar ao fechar). No iOS, combine com `overscroll-behavior: contain` no corpo da folha.
- Com o teclado aberto, o botão principal deve continuar visível (`visualViewport` ou `scroll-padding-bottom` + `scrollIntoView` ao focar).

## F5. Campos de valor com teclado certo

**P1 · S · `ui.tsx` (`MoneyInput`)**

- `inputMode="numeric"` (máscara em centavos) e `enterKeyHint="done"`.
- `autoComplete="off"` e `autoCorrect="off"`.
- Aceitar prop `autoFocus`.
- `aria-label` quando não houver `label`.
- Selecionar todo o conteúdo ao focar (`onFocus={(e) => e.target.select()}`), para corrigir um valor sem apagar caractere por caractere.

---

# G. Backend: endpoints e correções

| # | Endpoint / mudança | Usado em | Detalhe |
|---|---|---|---|
| G1 | `GET /categories/frequent?kind=` | B3 | Top 5 por contagem de lançamentos nos últimos 90 dias, por tipo; devolver `id, name, parent_id, color, icon`. Excluir arquivadas. |
| G2 | `GET /transactions/suggestions?kind=` | B4 | Últimas ~30 descrições distintas não vazias, com `category_id` da ocorrência mais recente. Respeitar a casa do usuário. |
| G3 | `PATCH /goals/:id` | E5 | Aceita `name`, `target_cents`, `deadline`. Reaplica a regra de conclusão (conclui e dá 100 XP uma vez; reabre se o alvo ficar acima do guardado). |
| G4 | `GET /export/transactions.csv` | E8 | CSV com data, descrição, valor, tipo, categoria, subcategoria, conta/cartão, situação, de quem. Escapar aspas e usar UTF-8 com BOM para abrir bem no Excel. |
| G5 | `/dashboard` com `evolution` | C2 | `{ current: number[], previous: number[] }` acumulado por dia, com a mesma regra do cliente (ver C2). |
| G6 | `/push/*` | F3 | `key`, `subscribe`, `unsubscribe` + tarefa diária. |
| G7 | Orçamento: soma do topo | (doc) | O `sistema.md` registra que, se pai e filha têm orçamento, a despesa entra duas vezes no total do topo (e na missão "ficar abaixo do orçamento"). Corrigir somando só categorias raiz ou descontando as filhas quando o pai já está orçado. |
| G8 | `display_status` / id de upcoming | C1, E1 | Garantir que `upcoming` de tipo `tx` traga o id do lançamento (ou `tx_id`) e documentar os valores de `display_status`. |
| G9 | Dados de faturas | C2 | Opcional: `/cards/month/:mes` poderia vir dentro do `/dashboard` (uma chamada a menos). |

Todas as rotas novas seguem as regras atuais: sessão por cookie, escopo da casa (`household`), e valores em centavos inteiros.

---

# H. Atualizar o `sistema.md`

Depois das mudanças, estes trechos ficam desatualizados:

- **Início, item 12 (Configurar resumo):** trocar "Arrastar muda a ordem" por "As setas ↑ ↓ mudam a ordem"; manter "fica gravado neste aparelho (`fin-home-layout`)" (agora é verdade). Incluir "Restaurar padrão".
- **Início, ordem padrão:** "Faturas dos cartões" passa para depois de "Próximos vencimentos".
- **Início, Próximos vencimentos:** tocar numa conta abre a ficha ali mesmo; fatura ganha botão **Pagar**.
- **Olho de ocultar valores:** deixa de ser "só no Início"; vale para todo o app (desfoque nas outras telas) e há "Ocultar ao sair do app" em Mais.
- **Lançamentos:** novo seletor de situação (Todos / A pagar / Vencidos / Pagos); remover a menção à linha "Cartões de crédito" da folha de resumo.
- **Novo lançamento:** atalhos de data, "Lançar e novo", categorias frequentes, destino lembrado e resumo do destino.
- **Cartões:** contagem regressiva, melhor dia de compra, alerta de limite e menu em folha.
- **Visão anual:** abre compacta no celular.
- **Calendário:** lista "Próximos 7 dias" e marca de atrasado.
- **Orçamento:** "restam", alerta a 80% e projeção.
- **Metas:** depósito rápido, edição e "guarde X por mês".
- **Mais:** seções, privacidade e exportação.
- **Onde o aplicativo roda:** PWA, HTTPS obrigatório para instalar e para push.

---

# I. Roteiro, testes e decisões

## I.1 Ordem sugerida de execução

**Sprint 1 · Correções (meio dia)**
A1 (ordem + toque) → A2 (scroll do Ano) → A4 (useConfirm + 6 confirmações) → A3, A5, A6, A7, A8, A9.

**Sprint 2 · Lançar e toque (meio dia)**
F1 (CSS de toque/safe area) → B1 → B2 → B5 → B6 → F5.

**Sprint 3 · Home e Cartões (1 dia)**
C1 → D1 → D2 → D3 → D4 → D5 → C6.

**Sprint 4 · Visão e privacidade (1 dia)**
C5 → E1 → E3 → E6 → E4 → E5 → E7.

**Sprint 5 · Desempenho e backend (1 a 2 dias)**
C2 (opção B primeiro, opção A depois) → C3 → C4 → B3/B4 (G1, G2) → G3, G4, G7, G8.

**Sprint 6 · Plataforma (1 a 2 dias)**
Resolver HTTPS → F2 (PWA) → F4 (Sheet) → E2 (swipe) → F3 (push) → E8, E9, E10 → H (docs).

## I.2 Checklist de testes no celular (rodar a cada sprint)

Dispositivos: um iPhone (Safari) e um Android (Chrome), com o app instalado (PWA) e no navegador.

- [ ] Largura 360 × 800: nada transborda na horizontal (exceto a tabela anual completa).
- [ ] Tema claro, escuro e automático em cada tela alterada.
- [ ] Teclado aberto: o botão principal da folha continua visível.
- [ ] iPhone com "barra home": a barra inferior e o botão **+** não ficam cobertos.
- [ ] Rotação para paisagem: a tela não quebra.
- [ ] Alvos de toque de 44 px (conferir "Corrigir", "remover", botões `sm`).
- [ ] Toque duplo rápido em "Lançar", "Pagar", "Excluir": uma só ação acontece.
- [ ] Sem internet: abre a casca e mostra erro claro; nada de tela em branco.
- [ ] Reabrir o app depois de fechar: layout da Home, tema, olho e último destino mantidos.
- [ ] Ocultar valores: Home, Lançamentos, Calendário, Ano, Contas, Cartões.
- [ ] Cada confirmação (A4): cancelar não executa; confirmar executa uma vez.
- [ ] Mês e ano de virada (dezembro → janeiro) em Calendário, Orçamento e Cartões.
- [ ] Cartão com fechamento dia 29–31 em fevereiro.

## I.3 Decisões que são suas

1. **Ocultar valores:** padrão desligado, ou "iniciar oculto"? (C5 oferece as duas.)
2. **Ordem padrão da Home:** concorda em subir "Faturas dos cartões"? (C6)
3. **Visão anual:** abrir compacta por padrão no celular? (E6)
4. **Offline:** só casca do app, ou também cache de dados? (F2; recomendo só a casca.)
5. **Notificações:** valem a manutenção do push no servidor? (F3 é o item mais caro.)
6. **Backend:** quem altera a API (você ou eu, se me enviar o código)? Os itens G1 a G9 dependem disso.

## I.4 Sobre os arquivos (para depois)

Como você pediu, a entrega dos arquivos alterados fica para o próximo passo. Para as mudanças que tocam componentes que eu não vi (`ui.tsx`, `api.ts`, `TxSheet`, `TxMenu`, `categories.tsx`, CSS), preciso desses arquivos para escrever as alterações sem suposições. Os itens **A1, A2, A3 (parte TSX), A4, A5, A6, A7, A8, A9, B1, B2, B5, D1 a D5, E1, E3, E4, E5 (sem editar), E6, E7, E8 (seções)** eu consigo entregar já nos seus `.tsx`, pois dependem só do que enviou.
