# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projeto

"Finanças do casal": app de controle financeiro de **uma única casa** (Diego e Jhersyka). Toda a UI, mensagens de erro, comentários e documentação são em **português do Brasil** — mantenha assim.

Documentos de produto (leia antes de mudar regra de negócio ou tela):
- `premissas.md` — decisões de produto que **não podem ser reinterpretadas** (cartão/fatura, competência, recorrências, parcelamentos, Eu/Nós, XP, acesso). É a fonte de verdade.
- `sistema.md` — o que cada tela faz hoje, layout celular/desktop (corte em 960px), cálculo de saldo. Quando uma melhoria muda a interface, atualize este arquivo.
- `app_financas_documentacao.md` — especificação original (histórica; `premissas.md` prevalece).
- `correcoes/` — planos de melhoria e revisões de layout em andamento.
- `schema.sql`, `schema (1).sql`, `design/`, `Exemplos/` e os `*-html.zip` na raiz são material de referência, não código ativo. O schema real está em `database/`.

## Comandos

Node 22+. Monorepo com npm workspaces (`@fin/domain`, `@fin/db`, `@fin/api`, `@fin/web`).

```bash
npm install
npm run seed          # cria apps/api/data/financas.db (SQLite) com dados demo
npm run dev           # API :3001 (tsx watch) + Vite :5173 (proxy /api -> API_URL ou localhost:3001)
npm test              # vitest: packages/*/src/**/*.test.ts e apps/api/src/**/*.test.ts
npm run lint          # eslint + typecheck (tsc em cada workspace)
npm run typecheck
npm run build         # build do web
npm run migrate
```

- Um arquivo/teste: `npx vitest run packages/domain/src/domain.test.ts` ou `npx vitest run -t "nome do teste"`.
- Testes de schema e API rodam em SQLite em memória; com `TEST_PG_URL=postgres://...` repetem também em Postgres (`describe.each(targets)` em `apps/api/src/api.test.ts`).
- Portas alternativas: `PORT=4817 npm run dev -w @fin/api` e `API_URL=http://localhost:4817 npm run dev -w @fin/web -- --port 5917`.
- Logins demo: `diego@demo.local` / `jhersyka@demo.local`, senha `demo1234`.
- Não há testes do frontend; `apps/web` só é validado pelo typecheck/eslint (inclui regras de `react-hooks`).

Produção (NAS): `docker compose up -d --build` com `.env` baseado em `.env.example` — serviços `db` (Postgres 16), `api` (aplica migrations ao iniciar), `web` (nginx servindo o build e repassando `/api`, porta 3003) e `backup` (pg_dump diário). Ver `deploy/`.

## Arquitetura

**`packages/domain`** — regras puras, sem I/O, compartilhadas entre API e web: centavos/formatação (`money`), datas e meses `YYYY-MM` (`dates`), status derivado (`status`), divisão de parcelas (`installments`), fechamento/vencimento de fatura (`invoice`), saldo (`balance`), XP/nível (`gamification`). Regra de cálculo nova deve morar aqui, com teste em `domain.test.ts`.

**`packages/db`** — interface mínima `Db` (`all/get/run/exec/tx`) com dois adaptadores: SQLite (better-sqlite3, conexão única protegida por mutex nas transações) e Postgres (`pg`). O SQL é escrito **uma vez**, com placeholders `?`, compatível com os dois dialetos; o adaptador PG converte para `$n`. `createDb(url)` escolhe pelo prefixo (`sqlite:` / `postgres://`).
- Migrations: `database/schema_v0.3.sql` é a base (`001`), depois `database/migrations/NNN_*.sql` em ordem alfabética, registradas em `schema_migrations`. `adaptSql` reescreve `id INTEGER PRIMARY KEY` para identity no PG. Nova mudança de schema = novo arquivo numerado, SQL que roda nos dois bancos; nunca edite migrations já aplicadas.

**`apps/api`** — Express 5. `app.ts` monta tudo sob `/api`: `/auth` é público, o resto passa por `requireAuth`, que preenche `req.ctx: Ctx` (`db`, `userId`, `householdId`, `role`, `timezone`, `today`). Cada arquivo em `src/modules/` exporta um ou mais `xxxRouter()`.
- Helpers centrais em `core.ts`: `parse(zodSchema, body)` (400 com detalhes), `HttpError`/`badRequest`/`notFound`/`forbidden`, `requireAdmin`, `insert`/`update`, `owned(ctx, table, id)` (garante `household_id` e `deleted_at IS NULL`), `findByUuid` (idempotência por `client_uuid`), validadores `zCents`, `zDate`, `zMonth`, `zFlag`.
- **Toda consulta filtra por `household_id = ctx.householdId`**; exclusão é soft (`deleted_at`) e contas/cartões com histórico são arquivados.
- "Hoje" vem de `ctx.today` (fuso da casa; `FIXED_TODAY` fixa em dev/testes) — não use `new Date()` para regra de vencimento.
- Recorrências são materializadas sob demanda: `ensureRecurrences(ctx, untilMonth)` é chamado por lançamentos/relatórios antes de ler um mês.
- Filtro Eu/Nós: consultas recebem `personId` e filtram por `for_user_id` (ver `modules/queries.ts`).
- `config.ts` lê env (`DATABASE_URL`, `SESSION_SECRET`, `COOKIE_SECURE`, `ALLOW_REGISTER`, `WEBAUTHN_RP_ID/ORIGIN`). Sessão é JWT no cookie httpOnly `fin_session`. Erros 500 são logados sem o corpo da requisição (não registrar valores nem senhas).
- `api.test.ts` testa via supertest contra `createApp` com banco em memória e `TODAY` fixo.

**`apps/web`** — React 18 + Vite + TanStack Query + react-router, PWA (`public/sw.js`, manifest), mobile-first.
- `api.ts`: `api()` (fetch em `/api`, lança `ApiError`), `useApi(path)` para queries e `useAction` para mutações; `clientUuid()` gera o `client_uuid` dos lançamentos.
- `state.tsx`: estado de sessão — mês selecionado, `person` (`'me'` padrão = Eu, `'all'` = Nós), toasts e `celebrate` de XP. Eu/Nós e mês **não** são persistidos.
- Preferências locais em `localStorage`: `fin-theme`, `fin-hide-money` (`privacy.ts`), `fin-home-layout`.
- Telas em `src/pages/`; folhas reutilizáveis na raiz de `src` (`TxSheet`, `PaySheet`, `SettleSheet`, `TxMenu`); primitivos de UI em `ui.tsx`; estilos globais em `styles.css` (variáveis CSS, tema claro/escuro via `data-theme`).
- Ícones são `lucide-react` (`ui.tsx`'s `Icon`), não mais SVG caseiro — o kit anterior tinha peso visual desigual entre ícones (ex.: "casa" parecia mais "cheio" que os outros no mesmo traço). O objeto `Icon` só envolve cada ícone do Lucide numa função sem argumento (`Icon.home = () => <House aria-hidden />`) pra manter a mesma API de antes (`<Icon.xxx />` em ~30 lugares, incluindo chamada direta tipo `Icon.check()` dentro de `StatusIcon`) — **novo ícone entra nesse objeto, nunca importado direto do `lucide-react` nas telas.** Tamanho e cor continuam vindo do CSS (`svg{width,height}` por contexto, `color: currentColor`), não de props do componente.
- `charts.tsx`: motor de gráficos do app, em `@visx` (primitivas SVG pequenas, não um pacote de gráfico pronto). Cada gráfico mede a própria largura com `@visx/responsive` (`ParentSize`) em vez de depender do pai ter altura definida. Cores sempre por variável do tema (`var(--pos)`/`var(--exp)`/`var(--chart-cum)`/`var(--bar-empty)`), nunca hex fixo, pra herdar claro/escuro. Texto de eixo que revela valor em reais leva `className="ax"`, escondido pelo modo "ocultar valores" (`html[data-hide-money="1"] .ax`). `CartoesPage.tsx` tem seu próprio SVG à mão (`.cchart`), fora desse módulo.
  - `Donut`: número da fatia não usa `inkOn` (preto/branco binário) — é sempre branco com contorno (`stroke`/`paintOrder="stroke"`) numa versão escurecida da própria cor da fatia (`shadeOf`), pra ficar legível em qualquer cor sem parecer "chapado". Entrada tem animação (`.donut-svg`/`donut-pop`) e cada fatia "levanta" sutilmente no hover/toque (`.donut-slice`, variáveis CSS `--tx`/`--ty` calculadas a partir do centróide do arco). Ambos respeitam `prefers-reduced-motion`.
- Cabeçalho de card (`.hd`) é `display:flex; justify-content:space-between` com só **2 filhos**: um bloco à esquerda (título, e opcionalmente uma legenda curta em `.hd-title`/`.hd-desc`) e, à direita, o link "ver mais" (`.home-jump`). Nunca passar de 2 filhos direto em `.hd` — um 3º item (ex.: título + parágrafo + link soltos) faz os filhos disputarem espaço e o `<h2>` quebra palavra por palavra. Legenda abaixo do título só se agregar informação que o título não diz (ex.: "Próximos 30 dias", "Comparado ao mês anterior") — nunca uma frase que só reafirma o título.
- `useInView` (`useInView.ts`) é o hook genérico de "entrou na tela" (IntersectionObserver, dispara uma vez e trava em `true`). No Início, todo card do `home-stack` passa por `RevealItem` (em `HomePage.tsx`), que usa esse hook pra um fade+subida na primeira vez que aparece (`.reveal`/`.reveal.in`, com atraso escalonado por índice). Os blocos `evolution`/`year` também usam a própria ref do `useInView` (`evoRef`/`yearRef`, margem maior) pra **antecipar o carregamento dos dados do gráfico**, via `forwardRef` — são dois usos independentes do mesmo hook, não confundir um com o outro.
- `usePullToRefresh.ts`: gesto de puxar pra atualizar (só dispara com `window.scrollY <= 0`). O `touchmove` é `{ passive: false }` e chama `preventDefault()` enquanto o dedo desce (`dy > 0`) — sem isso o bounce elástico nativo do celular soma com a nossa animação e o ícone pisca atrás do que está acima dele por um frame. O indicador (`.ptr` no `HomePage.tsx`) é ícone (`Icon.arrowDown`, gira 180° ao cruzar o limiar) + rótulo curto; durante o refresh troca pro spinner (`.ptr-spinner`). Sem transição CSS enquanto está sendo arrastado (`pull > 0`, pra acompanhar o dedo 1:1); transição entra só ao soltar/terminar (`pull === 0` ou `busy`).
- **Linha de lançamento com "leader" pontilhado**: `TxLine` (`LancamentosPage.tsx`) e o `due-row` do Início (`HomePage.tsx`) usam o mesmo truque de CSS pra ligar o título ao valor — `.tx-top`/`.due-top` (flex row, `align-items:baseline`) com um `<i>` de `flex:1` e `border-bottom:1px dotted var(--line)` (`.tx-leader`/`.due-leader`) entre o título e o valor; categoria/conta/data viram texto secundário numa segunda linha (`.tx-bottom`/`.tx-meta`). Isso só funciona porque título e valor ficam numa única linha — não dá pra aplicar em blocos com texto de altura variável dos dois lados. **Não repita o nome da conta/cartão como "kicker" dentro de um grupo** (`PlaceRow`) — o cabeçalho do grupo já diz; `TxLine`'s `kicker` é opcional e só deve ser usado fora de um grupo.
- Em `CartoesPage.tsx`, `CardBlock` mostra a fatura (quanto falta pagar, badge de estado, botão de pagar) **logo depois do cabeçalho**, antes de limite/disponível/conta/fechamento/vencimento — é a pergunta que mais importa num cartão. Cabeçalho do cartão só tem **+** (nova compra) e o menu "⋮"; não duplicar ali uma ação que já está dentro do "⋮" (ex.: não adicionar de volta ícones diretos pra "despesas associadas"/"evolução").
- Em `AnoPage.tsx`, a tabela (`table.year`) segue verde=receita/positivo, vermelho=despesa/negativo em tudo: cabeçalho de seção (`.s.inc`/`.s.exp`) e a linha Saldo (`.sd`, `.sd.neg` quando `d.balance.total_cents < 0`). Nunca hardcode fundo verde num desses sem checar o sinal do valor. A tela também reusa `YearBarChart` de `charts.tsx` (mesmo gráfico do bloco "Ano" do Início) como resumo visual acima da tabela detalhada — mantém a mesma linguagem visual nas duas telas.
- **Armadilha de nome**: `/api/dashboard`'s `expense.planned_cents` é despesa do mês **ainda não paga** (fluxo de caixa), não tem nada a ver com orçamento. O teto de orçamento de verdade é `/api/budgets`'s `planned_cents`/`spent_cents` (soma por categoria). Não confundir os dois só porque o nome do campo é parecido.

## Regras de negócio que mais quebram

- Dinheiro sempre em **centavos inteiros**; parcelas jogam os centavos restantes nas primeiras.
- Compra no cartão é despesa no **mês da fatura**; pagar a fatura só tira dinheiro da conta (não é despesa). Pagamento acima da fatura vira crédito da próxima.
- Compra no dia do fechamento ou depois entra na fatura seguinte; vencimento > fechamento vence no mesmo mês, senão no seguinte.
- Status (pago, atrasado, próximo ≤7 dias, previsto) é **calculado**, nunca gravado. Compra de cartão mostra status **"Pago"** por linha quando a fatura dela já quitou (`deriveStatus` em `packages/domain/src/status.ts`). Em `/transactions`, `settled_cents` ("Pago" de Lançamentos) é só **caixa de conta** (`!t.card_id && t.paid_on`) e nunca conta compra de cartão, mesmo com a fatura paga — só quitação de fatura move dinheiro de conta de fato. Já `pending_cents` ("A pagar") soma o caixa de conta ainda não pago **mais** a compra de cartão já lançada (`status === 'posted'`) cuja fatura ainda não quitou (`display_status !== 'paid'`); por transação, não pelo `remaining_cents` da fatura, então um pagamento parcial de fatura não é descontado aí até a fatura quitar por completo. "Pago" e "A pagar" não são espelhos um do outro de propósito — confirme qual dos dois está sendo lido antes de mexer.
- `include_in_reports = 0` ("Contar na soma" desligado) mexe no saldo mas fica fora de totais e orçamento.
- Transferência e "Corrigir fim do mês" não são receita nem despesa.
- Antes de alterar qualquer um desses comportamentos, confira `premissas.md`.
