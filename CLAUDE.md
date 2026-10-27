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

## Regras de negócio que mais quebram

- Dinheiro sempre em **centavos inteiros**; parcelas jogam os centavos restantes nas primeiras.
- Compra no cartão é despesa no **mês da fatura**; pagar a fatura só tira dinheiro da conta (não é despesa). Pagamento acima da fatura vira crédito da próxima.
- Compra no dia do fechamento ou depois entra na fatura seguinte; vencimento > fechamento vence no mesmo mês, senão no seguinte.
- Status (pago, atrasado, próximo ≤7 dias, previsto) é **calculado**, nunca gravado.
- `include_in_reports = 0` ("Contar na soma" desligado) mexe no saldo mas fica fora de totais e orçamento.
- Transferência e "Corrigir fim do mês" não são receita nem despesa.
- Antes de alterar qualquer um desses comportamentos, confira `premissas.md`.
