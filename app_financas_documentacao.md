# App de Finanças — Especificação Completa
## Produto, UX, regras de negócio, modelo de dados e plano de implementação

**Versão do documento:** 0.3  
**Status:** Especificação de partida. O comportamento atual está no README.  
**Base:** wireframes do projeto + referências visuais do My Finances + `schema.sql` v0.1/v0.2 + decisões registradas durante o desenho

O que mudou depois desta especificação:

- Uma casa só. A segunda pessoa entra em Casa e usuários, como membro, sem convite entre casas.
- Início, Lançamentos e Calendário abrem em Eu. Nós soma as duas pessoas. O que fica "da casa" aparece em Nós. O ano continua da casa inteira.
- O cartão mostra a logo do banco e a bandeira com ícone (Visa, Mastercard, Elo, American Express, Hipercard, Diners Club, Maestro). Outra aceita um nome livre.
- A senha continua. Em https com nome, o celular pode entrar com a digital ou o Face ID já salvos no aparelho. Em `http://IP` esse botão não aparece.

---

# 1. Visão do produto

O produto é um aplicativo de finanças pessoais para **casal**, com foco em:

- fluxo de caixa mensal;
- receitas e despesas;
- contas bancárias e dinheiro;
- cartões de crédito e faturas;
- compras parceladas;
- lançamentos recorrentes;
- planejamento previsto x realizado;
- visão anual;
- orçamento;
- metas;
- gamificação;
- operação compartilhada por um `household`;
- possibilidade de sincronização futura com operação offline.

A proposta não é apenas registrar gastos.

O aplicativo deve permitir responder rapidamente:

> **Quanto temos? Quanto já gastamos? Quanto ainda vamos gastar? Quanto ainda vamos receber? O que está comprometido no cartão? E como ficará o mês?**

---

# 2. Princípios do produto

## 2.1 Simplicidade no lançamento

O usuário deve conseguir registrar uma despesa ou receita rapidamente.

O formulário deve mostrar somente os campos necessários para a situação escolhida.

Exemplo:

```text
R$ ________

Descrição
[ Carro ]

Categoria
[ Transporte ▼ ]

Tipo
○ Única
○ Fixa
○ Parcelada

Data
[ 10/10/2026 ]

Conta
[ Bradesco ▼ ]

                    [ Lançar ]
```

O formulário deve se adaptar ao tipo de lançamento.

---

## 2.2 O aplicativo precisa trabalhar com passado, presente e futuro

Existem três estados conceituais:

```text
REALIZADO
↓
já aconteceu e afetou a conta

PREVISTO
↓
foi planejado, mas ainda não aconteceu

FUTURO
↓
parcelas, recorrências e obrigações que já estão comprometidas
```

O usuário deve enxergar os valores sem precisar fazer contas manualmente.

---

## 2.3 Cartão e conta são conceitos diferentes

Compra no cartão:

```text
Compra
↓
Despesa
↓
Categoria
↓
Fatura
↓
Pagamento da fatura
↓
Saída de dinheiro da conta
```

Conta corrente:

```text
Conta de luz
↓
Despesa
↓
Conta
↓
Pagamento
```

Receita:

```text
Salário
↓
Receita
↓
Conta
↓
Recebimento
```

Transferência:

```text
Bradesco
   ↓
Nubank
```

não é receita e não é despesa.

---

## 2.4 Nunca contar uma compra duas vezes

Uma compra realizada no cartão é uma despesa quando ocorre.

O pagamento da fatura é uma movimentação de caixa, mas **não cria outra despesa**.

Exemplo:

```text
Compra no cartão       R$ 500,00
Fatura                 R$ 500,00
Pagamento da fatura    R$ 500,00
```

A despesa deve continuar sendo:

```text
R$ 500,00
```

e não:

```text
R$ 1.000,00
```

---

# 3. Referências visuais utilizadas

Foram usados como referência:

1. wireframe do Dashboard;
2. wireframe de Lançamento rápido;
3. wireframe da Visão anual;
4. wireframe de Cartões e faturas;
5. telas reais do aplicativo My Finances fornecidas durante o projeto.

As telas do My Finances acrescentaram informações importantes que não apareciam completamente nos primeiros wireframes:

- saldo inicial;
- saldo atual;
- saldo previsto;
- contas;
- receitas previstas;
- despesas previstas;
- despesas fixas;
- despesas parceladas;
- despesas variáveis;
- status por vencimento;
- detalhamento/resumo;
- cartão dentro da visão de despesas;
- faturas;
- pagamentos realizados;
- pagamentos antecipados;
- limite utilizado;
- limite disponível;
- categorias hierárquicas.

---

# 4. Navegação principal

A navegação principal planejada é:

```text
Início
Lançamentos
   +
Cartões
Ano
```

O botão `+` é o principal CTA para lançamento rápido.

A tela de Metas não precisa ser uma aba principal; metas e missões podem aparecer dentro do Início e também em áreas secundárias.

---

# 5. Tela Início / Dashboard

## Objetivo

Mostrar em poucos segundos a situação financeira do mês.

## Informações

### Saldo

Mostrar:

- saldo do mês;
- receitas;
- despesas;
- valor previsto;
- situação da fatura;
- sequência de atividade;
- XP.

---

## Missão do mês

Exemplo:

```text
Missão do mês

Ficar abaixo do orçamento
██████████░░░░░ 72%

720 / 1.000
+50 XP
```

---

## Categorias

Mostrar distribuição das despesas por categoria.

Exemplo:

```text
Moradia        R$ 2.500
Transporte     R$ 1.100
Alimentação    R$   850
Serviços       R$   420
```

---

## Fatura

Mostrar a fatura em aberto mais relevante.

Exemplo:

```text
Ultra

Fatura atual
R$ 2.100,00

Vence em 06/11
```

---

# 6. Tela Lançamentos

A tela deve ser única, com duas abas:

```text
[ Despesas ] [ Receitas ]
```

Cada aba trabalha com o mês selecionado.

Exemplo:

```text
← Outubro →
```

---

# 7. Tela de Despesas

## Topo

```text
Despesas
R$ 11.511,18

← Outubro →

🔍   resumo   ⋮
```

---

## Linha de despesa

Cada lançamento pode mostrar:

- conta;
- descrição;
- dia;
- valor;
- categoria;
- categoria pai;
- status;
- parcela;
- indicador visual;
- menu de ações.

Exemplo:

```text
Bradesco                         10. Sáb.
Carro 1/60                      R$ 1.964,00

[ Transporte ]
```

---

## Status

Os status exibidos para o usuário podem ser:

### Pago

```text
Pago
```

### Pendente

```text
Pendente
```

### Próximo do vencimento

```text
Próximo
```

### Atrasado

```text
Atrasado
```

### Distante do vencimento

```text
Previsto
```

O status deve ser derivado das datas e da situação do lançamento, em vez de depender somente de texto salvo manualmente.

---

# 8. Despesas de cartão

Na tela de despesas, uma fatura pode aparecer como uma linha própria.

Exemplo:

```text
Ultra
Despesas do mês
R$ 1.874,06

[ Fatura fechada ]
```

Essa linha representa:

> dinheiro que ainda sairá da conta quando a fatura for paga.

Ela aparece na visão de caixa, mas não deve ser somada novamente como despesa por competência.

---

# 9. Tela de detalhamento das despesas

Abrir por botão de análise/resumo.

## Resumo

Exemplo:

```text
Detalhamento das despesas

Resumo

Referência                  outubro 2026
Registros                   17
Total                       R$ 11.511,18
Total sem cartões           R$  4.384,29
Não somadas                 R$      0,00
Total com não somadas       R$ 11.511,18
```

---

## Situação

```text
Pagas                       R$ ...
Próxima do vencimento       R$ ...
Vencidas                    R$ ...
Distante do vencimento      R$ ...
Não pagas                   R$ ...
Cartões de crédito          R$ ...
```

---

## Recorrência

```text
Fixas                       R$ ...
Parceladas                  R$ ...
Variáveis                   R$ ...
```

---

# 10. Tela de Receitas

A estrutura é equivalente à de despesas.

Exemplo:

```text
Receitas
R$ 8.329,72

← Outubro →

Bradesco                        30. Sex.
Salário dia 30                  R$ 3.335,36

[ Pagamentos ]
[ Salário ]
```

Outro exemplo:

```text
Bradesco                        15. Qui.
Salário dia 15                  R$ 4.994,36

[ Pagamentos ]
[ Salário ]
```

---

# 11. Detalhamento das receitas

## Resumo

```text
Referência                  outubro 2026
Registros                   2
Total                       R$ 8.329,72
Não somadas                 R$     0,00
Total com não somadas       R$ 8.329,72
```

## Situação

```text
Receitas recebidas
Próximas do recebimento
Vencidas
Distante do recebimento
Não recebidas
```

## Recorrência

```text
Fixas
Parceladas
Variáveis
```

---

# 12. Lançamento rápido

O lançamento rápido deve ser a principal forma de cadastrar movimentações.

## Fluxo básico

```text
Valor
↓
Tipo
↓
Categoria
↓
Forma de pagamento
↓
Parcelas
↓
Data
↓
Confirmar
```

Quando lançado:

```text
+10 XP
```

---

# 13. Tipos de despesa

## 13.1 Única

Uma ocorrência.

Exemplo:

```text
Estacionamento
R$ 130,00
30/10/2026
```

---

## 13.2 Fixa / recorrente

Exemplo:

```text
Internet
R$ 120,00
dia 10
mensal
```

Pode ter:

- início;
- fim opcional;
- conta;
- categoria;
- valor;
- periodicidade.

---

## 13.3 Parcelada

Exemplo:

```text
Carro
R$ 1.964,00
1/60
```

Cada parcela deve virar um lançamento independente, mas todas ficam vinculadas ao mesmo plano de parcelamento.

---

# 14. Parcelamento

O sistema precisa suportar:

```text
Parcelamento em cartão
```

e também:

```text
Parcelamento diretamente em conta
```

Essa segunda possibilidade foi identificada nas referências, por exemplo:

```text
Carro 1/60
IPVA Song Pro 1/3
FIES
```

Portanto, um plano de parcelamento deve poder ser ligado a:

```text
Cartão
OU
Conta
```

mas nunca aos dois simultaneamente.

---

# 15. Parcelas

Cada parcela deve possuir:

- número da parcela;
- plano;
- valor;
- competência;
- data;
- vencimento;
- estado;
- conta ou cartão;
- categoria.

Exemplo:

```text
Carro
1/60
2/60
3/60
...
60/60
```

Deve existir uma restrição lógica que impeça duas parcelas com o mesmo número dentro do mesmo plano.

---

# 16. Categorias

As categorias suportam hierarquia.

Exemplo:

```text
Transporte
├── Combustível
├── Estacionamento
├── IPVA
├── Seguro
└── Manutenção

Moradia
├── Aluguel
├── Condomínio
├── Energia
└── Internet
```

Uma categoria filha deve aparecer na lista junto à categoria pai.

Nos relatórios, o total do pai deve poder ser calculado pela soma das categorias filhas.

---

# 17. Classificação de recorrência

O produto trabalha conceitualmente com:

```text
Fixa
Parcelada
Variável
```

Regra inicial:

```text
recurrence_id != NULL → recorrente/fixa
plan_id != NULL       → parcelada
nenhum dos dois       → variável
```

Essa classificação pode ser refinada posteriormente para recorrências de valor variável.

---

# 18. Contas

Uma conta representa o local onde o dinheiro está.

Tipos:

```text
checking
savings
cash
wallet
investment
```

Exemplos:

```text
Bradesco
Nubank
Dinheiro
Poupança
Investimentos
```

---

# 19. Saldo da conta

O saldo não deve ser armazenado continuamente.

Ele deve ser derivado de:

```text
saldo inicial
+ receitas realizadas
- despesas realizadas
- pagamentos de faturas
- transferências enviadas
+ transferências recebidas
```

Isso evita inconsistências.

---

# 20. Saldo inicial

Cada conta deve possuir:

```text
initial_balance
initial_balance_on
```

Exemplo:

```text
Bradesco

Saldo inicial
R$ 4.500,00

Data
01/10/2026
```

A data é importante para reconstruir o saldo histórico corretamente.

---

# 21. Saldo previsto

O produto deve diferenciar:

```text
Saldo atual
```

de:

```text
Saldo previsto
```

Regra conceitual:

```text
Saldo previsto
=
saldo atual
+ receitas planejadas
- despesas planejadas
- faturas previstas
+ transferências planejadas
```

Lançamentos planejados ainda não devem alterar o saldo efetivo.

---

# 22. Transferências

Transferência entre contas:

```text
Bradesco → Nubank
```

não é:

```text
receita
```

nem:

```text
despesa
```

Ela apenas desloca dinheiro.

A operação deve possuir:

- conta de origem;
- conta de destino;
- valor;
- data;
- usuário responsável.

---

# 23. Cartões de crédito

Cada cartão deve possuir:

- nome;
- bandeira;
- limite;
- dia de fechamento;
- dia de vencimento;
- conta padrão para pagamento;
- status ativo/arquivado.

Exemplo:

```text
Ultra
Mastercard

Limite
R$ 14.100,00

Fechamento
07/09

Vencimento
06/10
```

---

# 24. Limite do cartão

O sistema deve mostrar:

```text
Limite total
R$ 14.100,00

Total em aberto
R$ 8.736,01

Limite disponível
R$ 5.363,99
```

Regra:

```text
limite disponível
=
limite total
- valor comprometido
```

O valor comprometido deve incluir as compras que ainda ocupam limite do cartão, conforme a regra do produto.

---

# 25. Faturas

Existe uma fatura por cartão por período de referência.

A convenção atual é:

> `reference_month` representa o mês em que a fatura vence.

Cada fatura possui:

- cartão;
- mês de referência;
- fechamento;
- vencimento;
- status;
- total;
- pagamentos;
- saldo restante.

---

# 26. Total da fatura

O valor total da fatura deve ser derivado das compras associadas a ela.

Conceito:

```text
Total da fatura
=
soma das transações vinculadas
```

Não usar `paid_amount` como substituto do total da fatura.

---

# 27. Pagamentos de fatura

Pagamentos devem ser modelados separadamente.

Exemplo:

```text
Fatura
R$ 8.736,01

Pagamento 1
R$ 5.000,00

Pagamento 2
R$ 3.736,01
```

Isso permite:

- pagamento parcial;
- pagamento integral;
- pagamento antecipado;
- múltiplos pagamentos.

---

# 28. Pagamento antecipado e crédito

O sistema deve estar preparado para situações em que:

```text
Pagamento > fatura atual
```

O excedente pode representar crédito.

A regra detalhada de utilização desse crédito ainda deve ser fechada antes da implementação final dessa funcionalidade.

---

# 29. Fatura e despesa

A fatura pode aparecer na tela de despesas como:

```text
Ultra
Fatura fechada
R$ 1.874,06
```

Mas a regra é:

```text
Compra no cartão → despesa
Pagamento da fatura → movimentação de caixa
```

Nunca contar os dois como despesas independentes.

---

# 30. "Não somadas"

O sistema deve permitir identificar lançamentos que aparecem na lista, mas que não devem participar de determinados totais analíticos.

Exemplo:

```text
Total
R$ 11.511,18

Não somadas
R$ 500,00

Total com não somadas
R$ 11.511,18
```

A decisão recomendada é possuir uma flag explícita, por exemplo:

```text
include_in_reports = 0/1
```

ou equivalente.

A regra exata de quais relatórios respeitam essa flag deve ser padronizada na API.

---

# 31. Previsto x realizado

Um lançamento deve ter uma distinção clara entre:

```text
planned
```

e:

```text
posted
```

### Planned

Ainda não aconteceu.

### Posted

Foi efetivado.

Exemplo:

```text
Salário dia 30

Hoje:
R$ 0 recebido

Previsto:
R$ 3.335,36
```

Ao efetivar:

```text
paid_on = data do recebimento
status = posted
```

---

# 32. Status derivado

Para despesas:

```text
paid_on != NULL
→ Pago

paid_on IS NULL
AND due_on < hoje
→ Atrasado

paid_on IS NULL
AND due_on está próximo
→ Próximo

paid_on IS NULL
AND due_on distante
→ Previsto/Pendente
```

A mesma lógica deve existir para receitas, adaptada ao recebimento.

---

# 33. Recorrências

Uma recorrência deve possuir:

- tipo;
- descrição;
- valor;
- categoria;
- conta ou cartão;
- dia do mês;
- início;
- fim opcional;
- ativa/inativa;
- usuário que criou.

Exemplos:

```text
Salário dia 15
Salário dia 30
Internet
Netflix
Aluguel
```

---

# 34. Geração de recorrências

Uma recorrência deve poder gerar um lançamento planejado para cada competência.

Regra importante:

```text
uma recorrência
+
uma competência
=
no máximo um lançamento gerado
```

Isso deve ser garantido por uma chave/constraint adequada ou por idempotência no serviço de geração.

---

# 35. Visão anual

Tela desktop:

```text
                    Jan   Fev   Mar   Abr ... Dez
Moradia            2500  2500  2500  2500
Alimentação          850   900   780   920
Transporte           650   700   710   690
...
```

A tabela deve conter:

- categorias nas linhas;
- meses nas colunas;
- total anual;
- receitas;
- despesas;
- saldo.

O mês atual deve possuir destaque visual.

No celular:

```text
┌─────────────────────────────┐
│ Jan Fev Mar Abr Mai Jun ... │
│ ← rolagem horizontal →      │
└─────────────────────────────┘
```

A rolagem acontece dentro da própria tabela.

---

# 36. Relatórios anuais

Precisamos suportar pelo menos:

```text
Receitas
Despesas
Saldo
```

e agrupamento por:

```text
Categoria
Categoria pai
Mês
Ano
```

O valor anual de uma categoria deve corresponder à soma dos valores mensais.

---

# 37. Orçamento

O modelo possui orçamento por:

```text
categoria
+
mês
```

Exemplo:

```text
Alimentação
Outubro
Planejado: R$ 1.000
```

A missão do mês pode consumir essa informação para medir progresso.

---

# 38. Metas

Metas possuem:

- nome;
- valor objetivo;
- valor acumulado;
- prazo;
- conclusão.

Exemplo:

```text
Viagem

Meta
R$ 10.000

Guardado
R$ 4.000

Progresso
40%
```

Metas não precisam ser uma aba principal.

---

# 39. Gamificação

A fonte da verdade deve ser uma tabela de eventos de XP.

Eventos previstos:

```text
tx_logged
week_review
month_closed
mission_done
goal_done
```

Exemplo:

```text
Lançamento registrado
+10 XP
```

---

# 40. Nível

O nível deve ser derivado do XP acumulado e não armazenado como fonte primária.

Regra atual do modelo:

```text
nivel = floor(sqrt(total_xp / 50)) + 1
```

---

# 41. Streak / sequência

O usuário pode possuir:

```text
current_days
longest_days
last_activity_date
```

Exemplo:

```text
🔥 12 dias
Melhor: 28 dias
```

A atividade deve ser definida pelo serviço de gamificação.

---

# 42. Conquistas

Exemplos:

```text
first_tx
streak_7
month_balanced
```

O sistema deve permitir adicionar novas conquistas sem modificar o modelo principal.

---

# 43. Missões

Exemplos:

```text
Ficar abaixo do orçamento
Registrar todos os dias
Atingir meta de economia
```

Cada missão possui:

- mês;
- tipo;
- categoria opcional;
- alvo;
- progresso;
- recompensa;
- data de conclusão.

---

# 44. Household / casal

A unidade de compartilhamento do aplicativo é o:

```text
household
```

Todas as principais entidades de negócio devem estar ligadas a ele.

Exemplo:

```text
Household
"Família"

├── Usuário 1
├── Usuário 2
├── Contas
├── Cartões
├── Categorias
├── Lançamentos
├── Recorrências
├── Orçamentos
└── Metas
```

---

# 45. Usuários e permissões

A estrutura deve suportar pelo menos:

```text
admin
member
```

Exemplo:

```text
Diego
Administrador

Esposa
Membro
```

A autenticação utiliza senha armazenada somente em hash. Em https com nome, a pessoa pode ainda registrar a digital ou o Face ID do próprio celular. A chave fica nesse aparelho e a senha continua como caminho reserva.

---

# 46. Sincronização offline

O modelo inicial já considera:

```text
client_uuid
```

para permitir idempotência em lançamentos criados no celular.

A arquitetura futura deve estender esse mecanismo para entidades que também possam ser criadas/editadas offline.

Entidades candidatas:

```text
transactions
transfers
accounts
credit_cards
invoices
invoice_payments
categories
recurrences
installment_plans
budgets
goals
```

Além de:

```text
updated_at
deleted_at
```

quando aplicável.

---

# 47. Integridade de dados

Regras fundamentais:

## Dinheiro

Sempre:

```text
INTEGER
```

em centavos.

Nunca usar `REAL` para valores monetários.

Exemplo:

```text
R$ 19,90
→ 1990
```

---

## Datas

Usar:

```text
YYYY-MM-DD
```

---

## Competência

Usar:

```text
YYYY-MM
```

Exemplo:

```text
2026-10
```

---

## Lançamento

Uma transação deve estar:

```text
em uma conta
OU
em um cartão
```

Nunca nos dois.

Nunca em nenhum.

Receita:

```text
não pode estar em cartão
```

---

# 48. Modelo de dados

## households

Domicílio/casal.

Campos principais:

```text
id
name
created_at
```

---

## users

Usuários do household.

```text
id
household_id
name
email
password_hash
created_at
role
```

---

## accounts

Onde o dinheiro está.

```text
id
household_id
name
type
initial_balance_cents
initial_balance_on
archived
```

---

## credit_cards

Cartões.

```text
id
household_id
name
closing_day
due_day
limit_cents
default_pay_account_id
archived
```

---

## invoices

Faturas.

```text
id
card_id
reference_month
closing_date
due_date
paid_on
paid_amount_cents
paid_from_account_id
```

A estrutura final deve evoluir para aceitar múltiplos `invoice_payments`.

---

## invoice_payments

Pagamentos de faturas.

```text
id
invoice_id
account_id
amount_cents
paid_on
created_by
created_at
```

---

## categories

Categorias.

```text
id
household_id
name
kind
parent_id
icon
color
sort_order
archived
```

---

## installment_plans

Planos de parcelamento.

Estrutura conceitual final:

```text
id
household_id
description
total_cents
installments
card_id nullable
account_id nullable
category_id
purchased_on
created_by
```

Regra:

```text
card_id XOR account_id
```

---

## recurrences

Recorrências.

```text
id
household_id
kind
description
amount_cents
category_id
account_id
card_id
day_of_month
start_month
end_month
active
created_by
```

---

## transactions

Coração do sistema.

```text
id
client_uuid
household_id
kind
description
amount_cents
occurred_on
due_on
paid_on
competence_month
category_id
account_id
card_id
invoice_id
plan_id
installment_no
recurrence_id
status
include_in_reports
created_by
created_at
updated_at
deleted_at
```

---

## transfers

Transferências internas.

```text
id
household_id
from_account_id
to_account_id
amount_cents
occurred_on
created_by
```

---

## budgets

Orçamento.

```text
id
household_id
category_id
month
planned_cents
```

---

## goals

Metas.

```text
id
household_id
name
target_cents
saved_cents
deadline
completed_at
```

---

## xp_events

Eventos de XP.

```text
id
user_id
type
xp
ref_id
created_at
```

---

## streaks

Sequência.

```text
user_id
current_days
longest_days
last_activity_date
```

---

## achievements

Conquistas disponíveis.

```text
code
name
description
```

---

## user_achievements

Conquistas desbloqueadas por usuário.

```text
user_id
code
unlocked_at
```

---

## missions

Missões.

```text
id
household_id
month
type
category_id
target
progress
xp_reward
completed_at
```

---

# 49. Constraints recomendadas

## Parcelas

```text
UNIQUE(plan_id, installment_no)
```

## Recorrências

```text
UNIQUE(recurrence_id, competence_month)
```

## Faturas

```text
UNIQUE(card_id, reference_month)
```

## Categoria

Garantir que `parent_id` pertença ao mesmo household.

## Cartão/conta

Garantir XOR:

```text
card_id IS NOT NULL
XOR
account_id IS NOT NULL
```

---

# 50. Consultas essenciais

A API deverá possuir consultas/regras para:

## Dashboard

```text
saldo atual
saldo previsto
receitas realizadas
receitas previstas
despesas realizadas
despesas previstas
faturas em aberto
XP
streak
missão
```

---

## Despesas

```text
total
total sem cartões
total não somado
total com não somados
pagas
próximas
vencidas
distantes
não pagas
cartões
fixas
parceladas
variáveis
```

---

## Receitas

```text
total
total não somado
recebidas
próximas
vencidas
distantes
não recebidas
fixas
parceladas
variáveis
```

---

## Cartão

```text
limite
comprometido
disponível
fatura atual
próximas faturas
total pago
saldo da fatura
```

---

## Ano

```text
categoria x mês
total anual
receitas
despesas
saldo
```

---

# 51. Regras de competência

Cada lançamento tem:

```text
occurred_on
```

e:

```text
competence_month
```

A data representa quando ocorreu.

A competência determina onde o lançamento aparece nos relatórios mensais/anuais.

No cartão, a compra deve ser associada à fatura correspondente à regra de fechamento.

---

# 52. Regra de fatura

Para uma compra no cartão:

1. identificar o cartão;
2. verificar o dia de fechamento;
3. determinar a fatura correspondente;
4. criar ou localizar a fatura;
5. associar `invoice_id`;
6. criar a transação;
7. refletir o compromisso no cartão;
8. não retirar dinheiro da conta ainda;
9. somente retirar dinheiro quando houver pagamento da fatura.

---

# 53. Regra de pagamento da fatura

Ao registrar:

```text
Pagamento de fatura
```

o sistema deve:

1. localizar a fatura;
2. localizar a conta;
3. criar um pagamento;
4. reduzir o saldo da conta;
5. reduzir o saldo restante da fatura;
6. manter as compras como despesas originais;
7. recalcular limite disponível conforme a regra do cartão.

---

# 54. UX para cartão

Tela principal:

```text
Cartões de crédito

Ultra
Mastercard

Limite                 R$ 14.100,00
Em aberto               R$ 8.736,01
Disponível               R$ 5.363,99

██████████████░░ 62%

Conta                   Bradesco
Fechamento              07/09
Vencimento              06/10

Fatura                  R$ 1.874,06
Pagamentos realizados   R$ 5.252,83
Despesas do mês         R$ 7.126,89

[ Fatura fechada ]
[ Registrar pagamento ]
```

---

# 55. Resumo de cartões

Pode existir uma visão agregada:

```text
Totais dos cartões

Limite total
R$ 14.100,00

Total em aberto
R$ 8.736,01

Limite disponível
R$ 5.363,99
```

E:

```text
Efetivadas
Pendentes
Fatura total
Pagamento antecipado
Referência
```

---

# 56. Responsividade

## Mobile

Prioridade:

```text
lançamento rápido
listas
status
cards
faturas
```

A tabela anual deve possuir rolagem horizontal.

---

## Desktop

Pode explorar:

```text
tabelas
gráficos
painéis
comparações
```

A visão anual deve utilizar mais largura de tela.

---

# 57. Visual

Direção visual já escolhida:

- fundo claro para os primeiros wireframes;
- bastante espaço;
- verde como cor principal;
- amarelo para XP e sequência;
- botões/chips com borda inferior mais forte;
- linguagem visual de gamificação inspirada em aplicativos como Duolingo;
- foco em hierarquia e legibilidade.

As referências reais trazidas pelo usuário utilizam tema escuro, e esse estilo pode ser considerado como alternativa para a aplicação final.

A decisão final de tema deve ser tomada antes do acabamento visual definitivo.

---

# 58. Arquitetura técnica recomendada

## Frontend

```text
React
Vite
TypeScript
```

ou JavaScript caso o código visual original exija compatibilidade específica.

---

## Backend

```text
Node.js
Express
```

---

## Banco

Para desenvolvimento inicial:

```text
SQLite
```

Para produção compartilhada no NAS:

```text
PostgreSQL
```

A arquitetura deve evitar acoplamento excessivo ao banco para permitir a migração.

---

# 59. Estrutura sugerida do projeto

```text
app-financas/
├── apps/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── shared/
│   ├── db/
│   └── types/
│
├── database/
│   ├── schema.sql
│   └── migrations/
│
├── docker/
│
├── docs/
│
├── docker-compose.yml
├── package.json
└── README.md
```

---

# 60. API — módulos

Sugestão:

```text
/auth
/households
/users
/accounts
/categories
/transactions
/transfers
/recurrences
/installments
/cards
/invoices
/invoice-payments
/budgets
/goals
/dashboard
/reports
/gamification
```

---

# 61. Endpoints essenciais

## Accounts

```http
GET    /accounts
POST   /accounts
PATCH  /accounts/:id
DELETE /accounts/:id
GET    /accounts/:id/balance
```

## Transactions

```http
GET    /transactions
POST   /transactions
PATCH  /transactions/:id
DELETE /transactions/:id
```

## Recurrences

```http
GET    /recurrences
POST   /recurrences
PATCH  /recurrences/:id
DELETE /recurrences/:id
```

## Cards

```http
GET    /cards
POST   /cards
PATCH  /cards/:id
DELETE /cards/:id
```

## Invoices

```http
GET /cards/:id/invoices
GET /invoices/:id
```

## Invoice payments

```http
POST /invoices/:id/payments
GET  /invoices/:id/payments
```

---

# 62. Segurança

Obrigatório:

- senha com hash;
- autenticação por sessão/token;
- validação de household em todas as consultas;
- nenhum usuário pode acessar dados de outro household;
- validação de payload;
- proteção contra SQL injection;
- logs de erros sem expor informações financeiras desnecessárias.

---

# 63. Docker / NAS

O aplicativo deve ser preparado para executar no NAS via Docker Compose.

Arquitetura inicial:

```text
Internet
   │
Cloudflare Tunnel
   │
Frontend
   │
API
   │
PostgreSQL
```

Para desenvolvimento interno:

```text
Browser
   ↓
Frontend
   ↓
API
   ↓
PostgreSQL
```

Backups do banco devem ser planejados desde o início.

---

# 64. Backup

O banco precisa possuir backup automatizado.

Estratégia mínima:

```text
backup diário
+
retenção de versões
+
cópia fora do container
```

O banco não deve depender exclusivamente do volume do container.

---

# 65. Observabilidade

Adicionar desde cedo:

```text
logs
healthcheck
```

Endpoint:

```http
GET /health
```

Resposta:

```json
{
  "status": "ok"
}
```

Opcionalmente:

```text
Uptime Kuma
```

pode monitorar o serviço.

---

# 66. Testes

## Unitários

Testar:

- cálculo de saldo;
- cálculo de fatura;
- classificação de status;
- parcelamento;
- recorrência;
- orçamento;
- XP.

## Integração

Testar:

```text
compra → fatura
fatura → pagamento
pagamento → conta
```

## Teste crítico

Garantir:

```text
Compra cartão de R$ 500
+
Pagamento de fatura de R$ 500

Despesa = R$ 500
Saída de caixa = R$ 500
```

e não:

```text
Despesa = R$ 1.000
```

---

# 67. Seed inicial

Criar dados fictícios para desenvolvimento:

## Conta

```text
Bradesco
```

## Cartão

```text
Ultra
Mastercard
Limite: R$ 14.100,00
```

## Categorias

```text
Moradia
Transporte
Alimentação
Serviços
Pagamentos
Salário
```

## Lançamentos

```text
Salário dia 15
Salário dia 30
Carro 1/60
IPVA Song Pro 1/3
Estacionamento
Crédito TIM
```

Esses dados devem ser somente de demonstração/teste.

---

# 68. Fases de implementação

## Fase 1 — Fundação

- projeto;
- Docker;
- banco;
- migrations;
- autenticação;
- household;
- usuários.

## Fase 2 — Contas

- contas;
- saldo;
- transferências;
- saldo previsto.

## Fase 3 — Lançamentos

- despesas;
- receitas;
- categorias;
- status;
- previsto/realizado.

## Fase 4 — Recorrências

- fixas;
- geração automática;
- edição de ocorrência;
- encerramento.

## Fase 5 — Parcelamentos

- parcelamentos por conta;
- parcelamentos por cartão;
- geração de parcelas.

## Fase 6 — Cartões

- cartões;
- fechamento;
- faturas;
- limite;
- pagamentos.

## Fase 7 — Dashboard

- resumo;
- categorias;
- missão;
- XP.

## Fase 8 — Visão anual

- tabela;
- filtros;
- receitas;
- despesas;
- saldo;
- previsto x realizado.

## Fase 9 — Gamificação

- XP;
- níveis;
- streak;
- conquistas;
- missões.

## Fase 10 — Refinamento

- responsividade;
- animações;
- acessibilidade;
- performance;
- backup;
- observabilidade.

---

# 69. Pendências antes de produção

Ainda precisam ser decididos:

1. regra completa para créditos gerados por pagamento antecipado de cartão;
2. exatamente quais relatórios respeitam `include_in_reports`;
3. regra de disponibilidade de limite quando há pagamento antecipado;
4. comportamento de uma parcela cancelada;
5. comportamento de recorrência cujo valor muda;
6. edição de uma ocorrência sem modificar a recorrência original;
7. política de arredondamento quando um parcelamento não divide exatamente em centavos;
8. timezone oficial do household;
9. permissões detalhadas entre membros;
10. política de exclusão/restauração de lançamentos;
11. migração definitiva de SQLite para PostgreSQL;
12. estratégia de sincronização offline completa.

---

# 70. Decisões já consolidadas

Estas regras devem ser consideradas fechadas:

- dinheiro em centavos;
- datas ISO;
- competência mensal `YYYY-MM`;
- household como unidade do casal;
- contas separadas de cartões;
- receita não pertence a cartão;
- compra no cartão é despesa;
- pagamento da fatura é caixa, não uma nova despesa;
- transferências não são receitas nem despesas;
- categorias com hierarquia;
- recorrências;
- parcelamentos;
- previsto x realizado;
- faturas associadas às compras;
- pagamentos de fatura separados;
- visão anual;
- gamificação;
- dashboard;
- lançamento rápido.

---

# 71. Próximo passo técnico

Antes de iniciar a implementação:

### Criar `schema_v0.3.sql`

A próxima versão deve incorporar, de forma definitiva:

```text
1. Parcelamento por conta OU cartão
2. include_in_reports / não somadas
3. invoice_payments
4. crédito/pagamento antecipado de cartão
5. initial_balance_on
6. unique de parcela
7. unique de recorrência + competência
8. regras de categoria pai/filho
9. role de usuário
10. preparação para sync offline
```

Depois:

```text
schema v0.3
↓
migrations
↓
API
↓
Frontend
↓
Docker
↓
NAS
```

---

# 72. Regra de ouro do produto

O aplicativo deve sempre responder corretamente a esta pergunta:

> **"Quanto dinheiro realmente tenho agora e quanto provavelmente terei depois de tudo que já está previsto?"**

E deve conseguir separar:

```text
O que já aconteceu
        ↓
O que está previsto
        ↓
O que está comprometido
        ↓
O que está no cartão
        ↓
O que já foi pago
        ↓
O que ainda falta pagar
```

Essa separação é o núcleo financeiro do produto.

---

# 73. Histórico das versões

## v0.1

Primeira estrutura do modelo:

- household;
- users;
- accounts;
- cards;
- invoices;
- categories;
- installment_plans;
- recurrences;
- transactions;
- transfers;
- budgets;
- goals;
- gamification.

Também definiu dinheiro em centavos, datas ISO e exclusão lógica.

## v0.2

Evoluiu o modelo para:

- vencimento;
- pagamento;
- status;
- consultas adicionais;
- melhor tratamento de faturas.

## v0.3 — especificação

Esta versão do documento consolida o que foi descoberto através das novas referências visuais e lista as alterações que precisam entrar no próximo schema antes da implementação.

---

# 74. Referências de dados

O `schema.sql` utilizado como base estabelece, entre outras regras:

- valores monetários armazenados em centavos;
- datas em ISO;
- household como unidade de negócio;
- exclusão lógica em transações;
- contas como locais onde o dinheiro está;
- cartões e faturas separados;
- `competence_month` para relatórios;
- `account_id XOR card_id`;
- receitas sem cartão;
- transferências fora de receitas/despesas;
- XP derivado de eventos.

Essas regras devem continuar sendo a base do sistema.

---

# 75. Conclusão

O produto já possui uma definição suficiente para sair de wireframes e começar a engenharia.

A prioridade agora não é criar mais telas.

A prioridade é:

```text
MODELO DE DADOS
        ↓
REGRAS FINANCEIRAS
        ↓
API
        ↓
INTERFACE
        ↓
DEPLOY NO NAS
```

O próximo artefato técnico recomendado é o **`schema_v0.3.sql`**, que será a primeira versão realmente preparada para implementar os comportamentos encontrados nas referências.
