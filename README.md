# Finanças do casal

App de controle financeiro do casal: saldo atual e previsto, despesas e receitas, fixas e parceladas, cartões e faturas, orçamento, visão anual, metas e gamificação.

Estrutura:

- `packages/domain`: regras puras (centavos, datas, status, faturas, parcelas, saldo, XP).
- `packages/db`: adaptador SQLite/Postgres e migrations (`database/schema_v0.3.sql` + `database/migrations/*.sql`).
- `apps/api`: API Express (`/api/...`).
- `apps/web`: React + Vite, responsivo (barra inferior no celular, lateral no desktop).

## Rodar no computador

Requer Node 22.

```bash
npm install
npm run seed      # cria o banco SQLite em apps/api/data com dados de demonstração
npm run dev       # API na porta 3001 e web em http://localhost:5173
```

Logins da demonstração: `diego@demo.local` e `jhersyka@demo.local`, senha `demo1234`.

Se as portas 3001 ou 5173 estiverem ocupadas:

```bash
PORT=4817 npm run dev -w @fin/api
API_URL=http://localhost:4817 npm run dev -w @fin/web -- --port 5917
```

Verificações:

```bash
npm test                                   # domínio, schema e API em SQLite
TEST_PG_URL=postgres://... npm test        # repete schema e API também no Postgres
npm run lint                               # eslint + typecheck
```

## Subir no NAS (Docker)

```bash
cp .env.example .env
# edite POSTGRES_PASSWORD e SESSION_SECRET (openssl rand -hex 32)
docker compose up -d --build
```

O app fica em `http://IP-DO-NAS:3003`, só na rede de casa. A primeira pessoa usa "Criar casa" (fuso `America/Sao_Paulo`) e, em Mais → Casa e usuários, adiciona a outra como membro da mesma casa. Os dois entram com o próprio e-mail.

Início, Lançamentos, Calendário e a visão anual abrem em **Eu**: só o que foi marcado como da pessoa logada. A faixa tem só Eu e Nós, no mesmo tamanho nas quatro telas. **Nós** soma os dois e mostra os dois avatares; Eu mostra só o de quem está logado. O que fica "da casa" (fatura, aluguel) aparece em Nós. Cartões, contas, orçamento e metas continuam da casa inteira.

No Início, a ordem é resumo do mês, próximos vencimentos, despesas por categoria, fluxo de caixa, evolução das despesas, despesas por recorrência (fixas, parceladas e variáveis), faturas, e o ano mês a mês. O olho esconde os valores neste celular. "Configurar resumo" reordena ou oculta esses cards, também só neste celular. O gráfico do ano abre no mês que está na tela; a sobra acumulada fica desligada até ser ligada. Tocar numa fatia da rosca abre a categoria; tocar numa barra do ano troca o mês. Se Outros estiver entre as maiores despesas, Classificar troca a categoria de cada gasto daquele mês. O total da rosca de categorias é o mesmo das despesas do resumo.

Nos próximos vencimentos, cada cartão entra uma vez, como "Fatura" mais o nome, no dia do vencimento, com a soma do que ainda está em aberto. Essa linha permanece na lista mesmo quando há outras contas no período. As compras do cartão não aparecem uma a uma.

Na visão anual, Realizado inclui o que já foi lançado e também a conta que ainda está a pagar, no mês do vencimento. A compra no cartão entra no mês da fatura. O número fica verde e em negrito quando o valor da célula já foi pago ou recebido por inteiro; se só uma parte foi paga, a célula fica na cor normal. Previsto acrescenta o que ainda é só previsão no cartão.

O cartão usa a logo do banco e a bandeira (Visa, Mastercard, Elo, American Express, Hipercard, Diners Club e Maestro). Uma bandeira fora dessa lista entra em Outra.

Depois do primeiro login com senha, o celular pode oferecer entrar com a digital ou o Face ID que já estão no aparelho. Cada um ativa no próprio celular. Em Casa e usuários dá para desligar o aparelho atual. A senha continua valendo. O botão só aparece em https com nome.

Depois das duas pessoas, coloque `ALLOW_REGISTER=false` no `.env` e suba de novo. A senha se troca em Casa e usuários; o administrador da casa também redefine a senha de um membro. Não há recuperação por e-mail.

Serviços do compose:

- `db`: Postgres 16 com volume `pgdata`, sem porta exposta.
- `api`: aplica as migrations ao iniciar e responde em `/api/health`.
- `web`: nginx servindo o build e repassando `/api` para a API.
- `backup`: `pg_dump` compactado todo dia às `BACKUP_HOUR`, guardado em `BACKUP_DIR` por `BACKUP_RETENTION_DAYS` dias. Aponte `BACKUP_DIR` para outro disco ou pasta sincronizada.

Restaurar um backup:

```bash
gunzip -c backups/financas-AAAAMMDD-HHMMSS.sql.gz | docker compose exec -T db psql -U financas -d financas
```

Para conferir o caminho do dump sem mexer no banco do NAS: `./deploy/restore-check.sh` (sobe um Postgres descartável, grava, restaura e apaga o container).

### Acesso fora de casa

Use Cloudflare Tunnel (ou Tailscale) em vez de abrir porta no roteador. Com o tunnel apontando para `http://web:80` ou `http://IP-DO-NAS:3003`, coloque `COOKIE_SECURE=true` no `.env`, porque o acesso passa a ser por HTTPS. Para a digital ou o Face ID, preencha também `WEBAUTHN_RP_ID` (o host, sem https) e `WEBAUTHN_ORIGIN` (a página inteira, com https). Em `http://IP-DO-NAS:3003` o celular recusa esses dois, e o botão não aparece.

## Regras adotadas

- Valores em centavos inteiros; arredondamento de parcelas coloca os centavos restantes nas primeiras.
- Compra no cartão é despesa no mês da fatura; pagar a fatura só tira dinheiro da conta.
- Compra feita no dia do fechamento ou depois entra na fatura seguinte.
- Pagamento acima da fatura vira crédito na próxima.
- Status (pago, atrasado, próximo, previsto) é sempre calculado a partir das datas.
- Fixas são geradas até dois meses à frente; mudar o valor afeta só as ocorrências futuras não editadas.
- Excluir é reversível; contas e cartões com histórico são arquivados.
- Lançamentos usam `client_uuid`, então reenviar o mesmo formulário não duplica.
