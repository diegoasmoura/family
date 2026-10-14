# Revisão de layout · Finanças do casal

Base: `styles.css` e `theme.ts` (os `.tsx` não estavam no disco desta vez). Conferi o resultado numa maquete que usa as suas classes, em 390 px, nos temas claro e escuro. Maquete não é o app: a fonte Nunito não carregou nela e os ícones são placeholders.

O `styles.css` entregue já traz tudo abaixo aplicado. Nada exige mudar o `.tsx` para funcionar; os itens da seção 3 são opcionais.

## 1. O que encontrei

| # | Problema | Onde | Gravidade |
|---|---|---|---|
| 1 | **Barra inferior corta o conteúdo em iPhone com barra home.** `--nav-h` era fixo em 76 px e o `padding-bottom` de safe area saía de dentro dele: sobravam ~42 px para itens de 44 px e para o botão + de 56 px. | `nav.tabbar` | Alta |
| 2 | **Texto verde/rosa com contraste insuficiente.** `#58cc02` sobre branco dá ~2,1:1 (células "pagas" da tabela anual). `#e08b84` e `#d45346` dão ~2,6:1 e ~4:1 (despesas na Home e no Ano). | `table.year .paid`, `.sum-val.exp`, `.year-lines .exp`, `.saldo-split b.exp`, `.ysel3 b.exp` | Alta |
| 3 | **Foco quase invisível.** Anel e borda de foco em `#58cc02` sobre branco (~2,1:1); nos campos o foco era só troca de cor da borda. | `:focus-visible`, `.f input:focus` | Média |
| 4 | **Duas linguagens visuais misturadas.** Botões, chips, meses e itens em "tecla 3D" (borda de baixo de 4 px), enquanto Home e Lançar migraram para cards planos. Tudo parece clicável com o mesmo peso. | `.chip`, `.mo button`, `.item-card`, `.btn.ghost` | Média |
| 5 | **Raios sem escala:** 10, 12, 14, 16, 18 e 24 px. O card da Home (24 px) tinha canto mais redondo que o do resto do app (16 px). | `.card`, `.page.home .card` | Média |
| 6 | **Saldo sem destaque.** 32 px com "R$" colado no número, quase do mesmo peso que o resto do card. | `.home-balance` | Média |
| 7 | **Alvos de toque abaixo de 44 px:** `.kebab` 36 de largura, `.btn.sm` 40, `.chip.sm` 36, `.who button` 36, `.cum-toggle` 32, `.link` ~30, ícones do topo 40. | vários | Média |
| 8 | **Texto de 10–11 px** em chips, parcelas, rótulos de resumo e eixos dos gráficos. | `.tx-chip`, `.tx-parcel`, `.st small`, `.ax` | Média |
| 9 | **Calendário sem estrutura no tema claro:** célula `--surface` (branca) sobre fundo branco. | `.cal-day` | Baixa |
| 10 | **Sem feedback ao tocar** em botões e linhas; `:hover` "gruda" depois do toque no celular. | `.r`, `.due-row`, `.menu button`, `.kebab`... | Média |
| 11 | **Folhas aparecem de repente**, sem alça e sem animação; sem `overscroll-behavior`, então rolar a folha rola a página. | `.sheet`, `.overlay` | Baixa |
| 12 | **`vh` no lugar de `dvh`** em `body`, `.app`, `.sheet`, `.sheet.full`: a barra do navegador cobre o fim da tela. | vários | Média |
| 13 | **Estado vazio é uma linha de texto.** | `.empty` | Baixa |
| 14 | `prefers-reduced-motion` cobria só toast e barras. | fim do bloco de motion | Baixa |

Itens do `theme.ts`: sem mudança. A troca de tema e o `theme-color` estão corretos.

## 2. O que mudou (resumo)

**Tokens novos** (`:root`): `--safe-top`, `--safe-bottom`, `--focus`, `--exp`, `--exp-fill`, `--press`, `--r-sm/md/lg/xl` (10/14/20/24).

| Área | Mudança |
|---|---|
| Barra inferior | `--nav-h` agora soma a safe area. Aba ativa ganha pílula `--green-soft` (antes só mudava a cor). Borda de 2 px → 1 px. No desktop `--nav-h` vira 0. |
| Hierarquia | Só `.btn` primário e `.fab` ficam em "tecla 3D", com efeito de apertar (`:active`). Chips, meses, itens e botões secundários: borda inferior de 2 px. |
| Cores | Texto de despesa usa `--exp` (≈5,4:1 no claro). Células pagas da tabela usam `--pos`. Barras vermelhas usam `--exp-fill`. Foco usa `--focus` e campos ganham anel de 3 px. |
| Raios | `.card` e `.page.home .card` em 20 px; folhas em 24 px. |
| Home | `.home-balance` de 34–42 px, peso 800, com o "R$" menor e cinza. |
| Tipografia | `line-height: 1.4` no corpo; nada abaixo de 12 px nos textos (eixos dos gráficos em 11 px). Pilha de fontes com `ui-rounded` como reserva do Nunito. |
| Toque | Alvos de 44 px (largura do `.kebab`, `.btn.sm`, ícones do topo) e área ampliada com `::after` onde o visual não deve crescer (`.link`, `.chip.sm`, `.who button`, `.cum-toggle`, `.ledger-row .o`). Feedback `:active` em linhas. `:hover` só em ponteiro fino. `touch-action: manipulation`. |
| Folhas | Alça (só no celular), entrada com `sheet-up`, `overscroll-behavior: contain`, `dvh` e safe area no `.sheet.full`. |
| Outros | Calendário com célula `--surface-alt`. `.skel` de esqueleto (mesmo nome do item C3 do plano). Movimento reduzido vale para tudo. |

## 3. Markup opcional (para aproveitar tudo)

**Estado vazio** (ícone + frase + ação):

```tsx
<div className="empty">
  <span className="empty-ic">{Icon.calendar}</span>
  <b>Nenhuma despesa neste mês</b>
  <p>Lance a primeira para ver o resumo e as categorias.</p>
  <button className="btn sm" onClick={abrirLancar}>Lançar despesa</button>
</div>
```

**Card do saldo na Home:** adicione `soft` ao card (`className="card soft"`). O CSS já tem esse fundo e os blocos `.saldo-split` ficam como peças brancas sobre ele, que é o que dá ao saldo o papel de destaque da primeira tela.

**Esqueletos:** use o `SkeletonCard` do item C3 do plano; a classe `.skel` agora existe no CSS.

## 4. Decisões que são suas

1. **Achatar chips e botões secundários (item 1 da seção 2).** É a mudança mais visível. Para voltar ao visual antigo, apague o bloco "1 · Hierarquia de ação" no fim do CSS.
2. **Raio de 20 px nos cards.** Se preferir 16, mude só `--r-lg`.
3. **Pílula na aba ativa.** Se achar pesada, remova `background` de `nav.tabbar a.active`.

## 5. O que não deu para verificar

- **Nunito:** não vi o `index.html`. Se a fonte não é carregada (Google Fonts ou `@font-face`), o app cai em `system-ui` e o visual muda por aparelho.
- **Safe area real:** a maquete não simula iPhone com barra home. A correção vem do cálculo (`--nav-h` + `--safe-bottom`), e só vale com `viewport-fit=cover` no `<meta viewport>`; sem isso `env()` devolve 0 e nada muda.
- **Linhas de Lançamentos ficam um pouco mais apertadas.** O `.kebab` passou de 36 para 44 px e os chips de 11 para 12 px; títulos longos truncam um pouco antes. Vale conferir com seus dados reais.
- **Conflito com o plano:** o item F1 do `plano-melhorias-financas.md` propõe CSS de safe area, `dvh` e alvos de toque. Isso já está aplicado aqui; use só o que o F1 tem a mais (`input { font-size: 16px }` e `overscroll-behavior` no `body`, esta última só se não for usar puxar para atualizar).
- **Pendente:** gráficos (rosca, evolução, barras) e a tabela anual não passaram por revisão visual, só por correção de cor e tamanho de texto. Para isso preciso de capturas de tela do app real.
