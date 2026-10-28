# Sistema de finanças do casal

Este texto descreve o que o aplicativo faz hoje: cada tela, a largura no celular e no computador, e as regras que calculam saldo, fatura, pago e previsto. O dinheiro é sempre um número inteiro de centavos. A tela formata em reais (`R$ 1.234,56`).

A casa é uma só. As duas pessoas entram com o próprio e-mail, como membros dessa casa. Não há convite entre duas casas na interface: o código desse convite existe, mas a API não o publica.

## Celular e computador

O corte é **960px** de largura da janela.

### Celular (até 959px)

A barra fica fixa embaixo, com altura **76px** (`--nav-h`). São cinco itens: Início, Lançamentos, botão **+** (56×56), Cartões e Ano. Os quatro nomes dividem a largura que sobra depois do **+**. No celular o nome fica curto, em 10px e numa linha: Início, Lançar, Cartão e Ano. O item ativo só fica verde, sem fundo. A marca “Finanças do casal” fica escondida. O botão **+** abre `/lancar`. Mais não entra nessa barra: no Início, o ícone de três pontos fica à direita do olho e abre `/mais`.

O conteúdo fica centralizado. As telas que não estão na barra (Calendário e tudo o que abre a partir de Mais) têm um botão Voltar à esquerda do título. Ele volta para a tela anterior; se a pessoa abriu o endereço direto, Calendário cai no Início e as outras caem em Mais. No computador esse botão some, porque a coluna da esquerda já leva a Mais.

| Tela | Teto da coluna | Padding lateral | Largura útil no teto | Fundo extra |
|---|---|---|---|---|
| Início (`.page.home`) | 560px | 16px de cada lado | **528px** | 148px, por causa da barra |
| Lançamentos (`.page.lanc`) | 560px | 16px | **528px** | 148px |
| Ano (`.page.wide`) | 1440px | 16px | a janela menos 32px | 104px |
| Contas, Cartões, Calendário, Mais e as telas de dentro de Mais (`.page`) | 560px | 16px | **528px** | 104px |
| Novo lançamento | folha em tela cheia, sem coluna `.page` | | | |

No celular, o bloco do Início (saudação, Eu/Nós, saldo, receitas e despesas) tem a **mesma largura útil** que Lançamentos: 528px. O que muda é o miolo. No Início a saudação ocupa a esquerda; à direita ficam o olho e, ao lado dele, os três pontos de Mais. Em Lançamentos o título “Lançamentos” fica sozinho na primeira linha, e Eu/Nós é a faixa de baixo, também com 100% da coluna.

### Computador (a partir de 960px)

A barra vira coluna fixa à esquerda, com **220px** de largura. O aplicativo ganha `padding-left: 220px`. A ordem visual da coluna é: **Novo lançamento** (botão de 52px de altura, largura da coluna, texto “Novo lançamento”), a marca “Finanças do casal”, Início, Lançamentos, Cartões, Ano e Mais. O item ativo fica com fundo verde claro. Cada item da coluna tem no mínimo 48px de altura.

| Tela | Teto da coluna | Padding lateral | Largura útil no teto |
|---|---|---|---|
| Início | **980px** | 16px | **948px** |
| Lançamentos | **760px** | 16px | **728px** |
| Ano | **1440px** | 32px nos quatro lados | **1376px** |
| Demais telas `.page` | **760px** | 16px | **728px** |

É por isso que, no computador, o bloco que começa em “Family / Olá, Diego”, passa por Eu/Nós e chega em saldo, receitas e despesas fica **mais largo** que o bloco de Lançamentos (948px contra 728px). Só o Início sobe o teto para 980px. Lançamentos herda os 760px das outras páginas. A faixa Eu/Nós, nos dois, ocupa 100% da coluna da própria página: ela é larga no Início e mais estreita em Lançamentos. O Ano é a tela larga de verdade, para a tabela dos doze meses.

O Início empilha os cards numa coluna só, dentro desses 980px. O CSS tem uma grade de duas colunas preparada, mas a página não a usa.

Início e Lançamentos continuam com 148px de respiro embaixo mesmo no computador, embora a barra já não esteja no pé da tela.

### Tipo e tema

A fonte é Nunito. No Início, em Lançamentos e no Ano o título da página tem 20px e peso 600. Os títulos de card do Início têm 18px e peso 600. Nas outras telas o título base é 18px e peso 700.

O tema claro, escuro ou automático fica neste aparelho, na chave `fin-theme`. Automático apaga a chave e segue o sistema. A troca está em Mais.

## Eu, Nós e da casa

A escolha começa em **Eu** e vale a sessão inteira: Início, Lançamentos, Calendário e Ano. Não fica gravada no aparelho. Recarregar a página volta para Eu. Nas quatro telas a faixa é a mesma: Eu e Nós dividem a largura da coluna, com o lado escolhido em destaque.

- **Eu** mostra só lançamentos com `for_user_id` igual a quem está logado. O que está marcado “Da casa” (`for_user_id` vazio) fica de fora.
- **Nós** não filtra. Entram as duas pessoas e o que é da casa.

No formulário de lançamento, “De quem” lista o primeiro nome de cada pessoa e o chip **Da casa**. O padrão é a pessoa logada.

Isto continua da casa inteira, mesmo em Eu:

- saldo atual e previsto das contas;
- lista de cartões, limite e faturas;
- bloco “Faturas dos cartões” do Início;
- vencimento de fatura nos próximos 30 dias;
- contas, transferências, orçamento (o teto) e metas.

O avatar do cabeçalho do Início segue Eu e Nós: em Eu só o de quem está logado; em Nós os dois. O número do nível é um selo no canto inferior direito do desenho, não em cima.

Em Eu, o “a pagar” do resumo não soma o restante das faturas. Em Nós, soma.

## Olho de ocultar valores

Só existe no Início. O botão mede 40×40, com cantos de 12px, e fica no canto direito do cabeçalho, depois dos avatares. A preferência fica neste aparelho, na chave `fin-hide-money`. Ligado, os valores do Início viram `R$ ••••`, inclusive o centro do gráfico de categorias e a dica da evolução. Lançamentos, Calendário e Ano não escondem.

Os avatares ficam à esquerda do olho, num grupo alinhado à direita. Trocar Eu e Nós muda quantos avatares aparecem (um ou os dois) e esse grupo cresce para a esquerda. O olho não muda de lugar.

Em Eu o avatar é o de quem está logado, com o número do nível por cima. Em Nós aparecem os dois. O toque no avatar abre a tela Avatar.

O nome pequeno acima de “Olá, Diego” é o nome da casa (por exemplo “Family”), não o nome do aplicativo.

## Cabeçalho do mês

Início, Lançamentos, Calendário, Cartões, Contas e Orçamento usam o mesmo miolo de mês: seta anterior, nome do mês e seta seguinte. O botão **Mês atual** só aparece quando o mês visto não é o de hoje, e a seta devolve o mês de hoje. O mês escolhido também vale entre essas telas, na mesma sessão. O Ano não usa esse miolo: as setas trocam o ano, e a tela abre sempre no ano de hoje, em Realizado, sem seguir o mês das outras telas.

No Início as setas do mês medem 40×40, cantos de 12px. Em Lançamentos os botões de busca e resumo medem 44×44, cantos de 14px. O único botão circular é o **+** da barra (56×56 no celular).

A faixa **Eu / Nós** do Início, de Lançamentos e do Ano ocupa a largura da coluna. A faixa tem 3px de respiro e cantos de 12px. Cada lado tem no mínimo 36px de altura, texto 14px, peso 600 e cantos de 10px. O lado escolhido usa a cor de superfície: branco no tema claro, cinza escuro no tema escuro. Em Lançamentos e no Ano, Despesas/Receitas e Realizado/Previsto usam essa mesma faixa. No Início não há essa segunda faixa.

O Calendário também tem Eu / Nós, no estilo antigo: texto sublinhado, 15px, peso 700, sem ocupar a largura toda.

## Regras que valem em todas as telas

### Competência

A célula do mês e a lista de lançamentos usam `competence_month`, não o dia em que a pessoa olhou a tela.

- Compra **avulsa ou parcela** no cartão: a competência é o mês da **fatura**. Nasce efetivada (`posted`), sem data de pagamento. Ela só fica “paga” quando a fatura quita.
- Cobrança **fixa** no cartão nasce prevista (`planned`) até alguém confirmar a ocorrência. A primeira, se a data da criação já chegou, pode nascer confirmada.
- Lançamento na **conta**: a competência é o mês da data. Se a data é hoje ou passou, ou se a pessoa marcou como pago, nasce efetivado e com `paid_on`. Senão nasce previsto (`planned`).

Fechamento da fatura: compra **antes** do dia de fechamento entra na fatura que fecha naquele mês. No dia do fechamento ou depois, entra na fatura seguinte. Se o dia de vencimento é maior que o de fechamento, a fatura vence no mesmo mês em que fecha. Se o vencimento é menor ou igual ao fechamento, vence no mês seguinte. Dia 31 em mês curto vira o último dia.

### Status na lista

O estado é calculado, não gravado. Em Lançamentos ele aparece como ícone: check verde, alerta vermelho, relógio âmbar ou relógio cinza. A palavra (Pago, Atrasado, Próximo, Previsto) fica para leitor de tela e para a ficha. No calendário a lista do dia escreve só Pago ou Previsto, também em receita.

- Conta com `paid_on`: Pago (despesa) ou Recebido (receita).
- Cartão: pago só se os pagamentos da fatura cobrem as compras mais o ajuste. Senão usa a data de vencimento da fatura.
- Sem pagamento: vencido é Atrasado (despesa) ou Vencida (receita). De hoje até 7 dias é Próximo. Depois disso é Previsto.

Receita não entra em cartão.

### O que entra na soma

`include_in_reports` desligado deixa o lançamento na lista, esmaecido, e tira do total do mês, do ano, do orçamento e dos gráficos. Continua na fatura. O padrão é somar.

Parcelas dividem o total em centavos inteiros. O resto de 1 centavo fica nas primeiras. Exemplo: R$ 100,00 em 3 vezes vira 33,34 + 33,33 + 33,33.

## Início

Ordem padrão, de cima para baixo:

1. Nome da casa, “Olá” e o primeiro nome, avatares e o olho.
2. Mês.
3. Eu / Nós.
4. **Resumo.** Saldo atual nas contas: é o saldo de hoje, em qualquer mês que esteja na tela. A faixa “Previsto no fim do mês” vai até o fim do mês visto e inclui correção de fechamento e fatura sem conta de pagamento. Duas colunas: Receitas (com “a receber” ou “recebidas”) e Despesas (com “a pagar” ou “pagas”). Receitas abrem Lançamentos em receitas. Despesas abrem Lançamentos. O “a pagar” daqui não é o mesmo número de Lançamentos: em Nós ele soma o restante das faturas do mês, e uma cobrança fixa prevista do cartão pode entrar nas duas contas. Se houver orçamento no mês, uma linha abaixo mostra gasto contra teto.
5. **Meta: gastar menos que recebe.** O card de destaque, logo depois do Resumo. Uma frase (“Sobra” ou “Falta” e o valor) e duas barras comparando Receitas e Despesas do mesmo mês, lado a lado. Não soma orçamento nem compara com o mês passado — isso já está no Resumo e na Evolução, respectivamente.
6. **Próximos vencimentos.** Link Calendário. Não segue o mês da tela: são contas previstas com vencimento até 30 dias à frente, mais as atrasadas. Agrupados por dia (Hoje, Amanhã, ou a data), com o saldo do dia (receita soma, despesa subtrai). Cada cartão em aberto entra **uma vez**, como “Fatura” mais o nome, na data de vencimento, com o que ainda falta. As compras desse cartão não aparecem uma a uma. As contas mostram no máximo cinco itens, as mais cedo; a fatura não entra nesse corte. Atrasado em vermelho, vence hoje em âmbar, receita com sinal de mais. Toque na fatura abre o cartão naquele mês, sem botão de pagar nessa lista. Toque na conta abre a ficha na própria tela. Se houver itens, aparece **Ver todos**. O que está com a soma desligada continua nesta lista.
7. **Faturas dos cartões.** Uma linha por cartão com fatura no mês: selo de estado, vencimento e o que falta. Fatura paga mostra o total na linha. Toque abre o cartão. O rodapé **Total das faturas** soma só o que ainda falta. Link **Cartões**.
8. **Despesas por categoria.** Rosca das cinco maiores; o resto vira “Demais categorias”. Toque na fatia ou na linha abre as subcategorias. “Demais categorias” não abre. Gasto lançado direto na categoria pai aparece como Geral. Se o nome for Outros ou Sem categoria, abre **Classificar**: cada gasto daquele mês ganha outra categoria, e a troca vale só naquele lançamento. Se houver orçamento, a barra fica de alerta a partir de 80% e vermelha ao chegar em 100%. Se Outros ou Sem categoria passar de 20% do mês, a tela avisa. Em Nós a rosca inclui o cartão, mas abrir a categoria não lista essas compras: elas foram para o bloco da fatura.
9. **Evolução das despesas.** Acumulado do mês de competência contra o mês anterior. No mês corrente, até hoje a linha é contínua e uma bolinha marca hoje; depois, tracejada, com o que ainda vai vencer neste mês. Em outro mês a bolinha fica no último dia. Mês futuro fica todo tracejado. A dica mostra “Este mês” e “Mês anterior”. Abaixo, quanto se gastou até hoje e o percentual contra o mesmo ponto do mês passado. A escala do eixo acompanha o ponto mais alto do gráfico, inclusive o tracejado e o mês anterior, então pode ficar bem acima do “até hoje”. Se até hoje a soma é zero, o gráfico some. Em Eu entram só os lançamentos da pessoa, inclusive a compra do cartão dela, uma parcela por mês da fatura, no dia do vencimento. Em Nós esta série deixa o cartão de fora, então pode divergir da rosca. O que está “Da casa” só aparece em Nós.
10. **Despesas por recorrência.** Fixas, parceladas e variáveis. Toque abre Fixas, Parcelamentos ou Lançamentos. Abaixo, “Parcelas futuras comprometidas”.
11. **Ano mês a mês.** O mesmo Eu ou Nós. O mês da tela começa selecionado e a faixa rola até ele. Toque numa barra troca o mês. “Sobra acumulada” começa desligada, mas embaixo das barras o mês selecionado sempre mostra receitas, despesas e **Sobra no ano**. O link “Visão anual” abre o Ano. Este gráfico usa o modo previsto.
12. **Configurar resumo.** Arrastar muda a ordem e isso fica gravado neste aparelho, junto com ocultar ou mostrar (`fin-home-layout`). O controle de cada card é o texto **Ocultar** ou **Mostrar**, não um olho. O olho do cabeçalho só esconde os valores.

Depois de rolar bastante, aparece um botão para voltar ao topo.

O saldo do resumo é de todas as contas: saldo inicial, mais o que já entrou e saiu até hoje, incluindo pagamentos de fatura e transferências. O previsto até o fim do mês inclui o que ainda está planejado e as faturas em aberto, na conta marcada para pagar o cartão.

## Lançamentos

Primeira linha: título “Lançamentos”, botão de resumo e botão de busca. Segunda: Eu / Nós, na largura da coluna (mais estreita que a do Início no computador). Terceira: Despesas / Receitas. Depois o mês, três números, a situação (Todos, A pagar, Vencidos, Pagos — chips, não a faixa cheia do Tipo) e a lista.

Os três números:

- Despesas ou Receitas: soma do que entra no relatório. Em Eu a compra do cartão entra aqui.
- Pago ou Recebido: o que já tem data de pagamento na conta. Compra de cartão não tem essa data, então não entra, mesmo com a fatura paga.
- A pagar ou A receber: o que ainda não foi pago na conta. Em Nós, nas despesas, soma também o restante das faturas. Em Eu a compra do cartão não entra neste terceiro número: os três podem não fechar.

Os três números não mudam com a situação escolhida: eles são o resumo do mês inteiro; a situação só filtra a lista abaixo.

Cada linha da lista tem o título e o valor na mesma altura, ligados por uma linha pontilhada (facilita achar o valor à direita). Categoria, subcategoria e de quem ficam numa segunda linha, menor, junto da data. O nome da conta ou do cartão não se repete em cada linha: já está no cabeçalho do grupo.

**Nós, em despesas:** as compras do cartão saem da lista solta e viram um bloco por fatura do mês, antes dos grupos de conta. O cabeçalho é o banco, o estado (Aberta, Fechada, Atrasada, Paga ou Futura) e o total da fatura. Se o pagamento foi parcial, o detalhe acrescenta “falta” e o valor que resta. Dentro, cada parcelamento é uma linha com `2/2`, `1/60` e assim por diante. Cada cobrança fixa do cartão é uma linha com a etiqueta **Fixa**. Compras avulsas do mesmo cartão somam numa linha “Outras compras”, com “N compras” quando há mais de uma; o toque abre o cartão, sem menu. O ajuste da fatura entra nessa linha ou numa linha “Ajuste”. Se a fatura só tem avulsas, a tela mostra só o cabeçalho. A busca não esconde esses blocos: ela só filtra as linhas soltas. Cada linha de conta e cada linha da fatura mostra um chip com o primeiro nome ou **Da casa**. Em “Outras compras”, esse chip só aparece se todas as avulsas daquela fatura forem da mesma pessoa.

**Eu:** não há bloco de fatura. A compra do cartão da pessoa aparece na lista, no grupo com o nome do cartão. O cabeçalho desse grupo diz “N no cartão”. A cobrança fixa do cartão leva a etiqueta **Fixa**. O chip de quem é a linha não aparece, porque a lista já é só de quem está logado.

**Conta (Bradesco, por exemplo):** um grupo por conta, com “N a pagar” e o total. Cada lançamento é uma linha: nome, parcela se houver, categoria e subcategoria, dia da semana e valor. A etiqueta Fixa **não** é escrita nessa linha de conta; a cobrança fixa da conta aparece como um lançamento normal. A etiqueta Fixa da conta aparece na visão anual, na linha do registro.

A busca olha descrição, categoria, conta e cartão, só na lista já carregada.

O resumo abre uma folha: registros, totais, total sem cartões, o que não entra na soma, total com essas linhas, situação (pagas, próximas, vencidas, distantes, não pagas) e a divisão fixas / parceladas / variáveis. A linha “Cartões de crédito” dessa folha fica zerada: nenhum lançamento recebe o status “cartão”.

Toque na linha abre a ficha. O menu da linha permite editar, mudar o valor, duplicar neste mês ou no próximo, ver a fixa ou as parcelas, e excluir. Em conta ainda não paga, **Pagar** ou **Receber** abre a folha Efetivar por cima da lista: nome, valor, data de pagamento, cápsula Vencimento (usa o vencimento, ou a data da linha) e a conta. Cancelar fecha sem gravar. Efetivar grava valor ou conta só nesta ocorrência, quando mudaram, e registra a data de pagamento. Desfazer o pagamento continua na ficha e no menu. Compra de cartão não usa essa folha: a quitação é a fatura, e o menu só confirma a compra.

Linha esmaecida é lançamento que não entra na soma.

## Calendário

Título, Eu / Nós e o mês. A grade começa na segunda-feira. O dia de hoje tem contorno verde.

Cada dia pode ter bolinhas: uma por pessoa que tem lançamento naquele dia, e uma da casa se houver conta da casa ou fatura. Vários lançamentos da mesma pessoa não multiplicam a bolinha.

Entram contas (pelo vencimento, ou pela data se não houver vencimento). Em Nós também entram faturas que vencem no mês: em aberto, pelo restante; pagas, pelo total. A compra solta do cartão não vira dia no calendário.

Toque no dia abre a lista, mesmo vazia (“Nada neste dia”). Cada item diz quem é: Você, o primeiro nome ou Da casa, com a cor da pessoa. A bolinha não separa receita de despesa. Conta tem **Abrir**. Fatura tem o link **Fatura**. O que já foi pago entra. Lançamento com a soma desligada também entra.

## Visão anual

Título “Visão anual · ano”, setas de ano, Eu / Nós e a faixa **Realizado / Previsto**. Três totais: receitas, despesas e saldo acumulado. Logo abaixo, o mesmo gráfico de barras do bloco “Ano” do Início (Receitas e Despesas por mês, com a opção de ver a sobra acumulada) — dá a visão de relance antes da tabela detalhada. A tabela rola na horizontal no celular. A coluna do mês atual fica destacada. Mês futuro fica mais claro. Célula zerada mostra “–”.

Árvore: categoria, subcategoria e, ao abrir, a linha do registro (Salário dia 15, IPVA, Youtube Premium). Se a categoria pai também tem lançamento direto, aparece uma filha “{nome} (geral)”.

**Realizado** inclui o que já foi lançado e também a conta que ainda está a pagar. A coluna é o mês de competência. Recorrência e parcela na conta nascem com o vencimento nesse mês. Lançamento avulso com vencimento noutro mês cai no mês da data, não no do vencimento. A compra no cartão entra no mês da fatura. **Previsto** acrescenta o que ainda é só previsão no cartão.

A célula fica **verde e em negrito** quando todo o valor dela já foi pago ou recebido. Conta: tem data de pagamento. Cartão: a fatura quitou. Se só uma parte pagou, a célula fica na cor normal. O cabeçalho da seção Receitas é verde; o de Despesas é vermelho. A linha Saldo fica verde quando o total do ano é positivo e vermelha quando é negativo — a mesma lógica das células. A tabela rola na horizontal também no computador. Ao abrir, centraliza o mês atual, que tem fundo amarelo. A primeira coluna fica grudada.

**Logo do banco** só na linha do registro, quando todo aquele registro veio de um banco ou cartão só. É a marca da biblioteca, no formato quadrado arredondado. Pagamentos, Salário, Transporte, Serviços e as outras categorias e subcategorias ficam só com o ícone da categoria. Se o nome não for um banco conhecido, a linha mostra o nome num selo, no lugar da logo.

**Fixa** também só na linha do registro, quando a recorrência tem dia. Vale em Eu e em Nós. O dia só entra no nome (“· dia 15”) quando existe outra linha com a mesma descrição. Descrições avulsas repetidas ganham “· avulsos”. Parcelamento não vira Fixa: o nome ganha “· 60x” (ou o número de vezes) e a lista do mês mostra `1/60`.

Toque num valor abre os lançamentos daquela célula. Toque num lançamento dessa lista abre a ficha. Toque numa categoria abre ou fecha a composição. “Expandir tudo” abre a árvore e vira “Recolher tudo” quando ela já está aberta.

## Novo lançamento

Folha em tela cheia.

1. Despesa ou receita. Trocar o tipo zera a categoria.
2. Valor. No parcelado, “Cada parcela” é o padrão; “Valor total” fica à direita.
3. Única, Fixa e, só em despesa, Parcelada. Receita não parcela.
4. No parcelado: de 2 a 480 vezes, com atalhos até 60. O texto diz o total e a partir de qual fatura, no cartão, ou o dia, na conta.
5. Categoria, opcional, com criação na hora.
6. De quem: cada pessoa ou Da casa. Começa em quem está logado.
7. Pagar com: em despesa, os cartões e depois as contas. Em receita, só contas. Sem escolha, a despesa cai no primeiro cartão, se houver, e senão na primeira conta. O **+** de um cartão já abre o lançamento naquele cartão. Sem conta e sem cartão, a tela pede para cadastrar uma conta.
8. Data. Na fixa é a primeira data. No parcelado é a data da compra. Compra única no cartão mostra em qual fatura ela cai, pelo mês de vencimento. Na fixa o texto é “todo dia D, a partir do mês”.
9. Descrição, opcional, até 120 caracteres.
10. Em conta, “Já pago” ou “Já recebido”. Na fixa e no parcelado o texto é “Primeira já paga” ou “Primeira já recebida”, e só a primeira nasce paga. O controle já vem marcado quando a data é hoje ou anterior. No cartão o controle some. A compra única já nasce na fatura. A fixa no cartão ainda usa esse padrão por baixo: a primeira nasce confirmada se a data já chegou; as seguintes nascem previstas.

O total parcelado precisa ter pelo menos 1 centavo por parcela. Fixa vazia vira “Despesa fixa” ou “Receita fixa”. Parcelado vazio vira “Parcelado”.

No celular, **Lançar** fica em cima e **Lançar e novo** embaixo, cada um na largura da folha. A partir de 640px os dois dividem a mesma linha. **Lançar e novo** permanece na folha, limpa valor, descrição e categoria, e troca o identificador do lançamento. O destino, a data, o tipo e de quem continuam.

Depois de lançar, o aviso é “Despesa lançada” ou “Receita lançada”, e a tela volta. O número de XP não aparece. Se o nível subir, um segundo aviso diz “Seu avatar subiu para o nível N”. Lançamento avulso vale 10 XP. Criar uma fixa vale 10 XP uma vez. Criar um parcelamento vale 10 XP uma vez, no plano, não em cada parcela.

## Ficha do lançamento

Ver: valor, status, categorias, de quem, cartão ou conta (só leitura), data, vencimento se for diferente, pago em, parcela `n/N`, e se veio de recorrência ou parcelamento.

Dá para editar descrição, valor, categoria e de quem. Dá para mudar a data de um lançamento avulso. Fixa ou parcela **no cartão** não deixa mudar a data: ela segue a fatura. Fixa ou parcela **em conta** só muda o dia dentro do mesmo mês.

Não dá para trocar o cartão, nem levar uma compra do cartão para uma conta, nem o contrário. A tela não oferece esses campos. Mudar a data de uma compra avulsa no cartão muda a fatura.

Na fixa e no parcelamento em conta, mudar o valor ou o dia pergunta se vale só para esta ou também para as seguintes, quando ainda existem outras. O campo é o dia de pagamento ou de recebimento, dentro do mês daquela ocorrência: o mês não muda. Só esta muda a ocorrência aberta e a série continua igual. Esta e as seguintes leva o dia para todas as que vêm depois, inclusive as que já foram pagas, e o valor só para as que ainda não foram pagas. As anteriores ficam. Descrição, categoria e de quem mudam só a ocorrência aberta. No cartão a data continua seguindo a fatura.

“Contar na soma” desligado deixa o lançamento na lista e na fatura, e tira do total do mês e do ano. Excluir é lógico: o registro some, o histórico de exclusão fica no banco. Na ficha e no menu de três pontos, fixa e parcela perguntam a mesma coisa: **Só esta** ou **Esta e as seguintes**. Esta e as seguintes apaga a aberta e as posteriores, mesmo as já pagas, e as anteriores ficam. Na fixa, a série para de gerar a partir desse mês. A última parcela, ou o último mês da fixa, só oferece apagar essa.

Marcar pago vale para conta. No cartão ainda previsto, o menu oferece **Confirmada**, não “pago”. Compra de cartão já efetivada não oferece essa marca. A tela não desmarca compra de cartão.

Duplicar pergunta “Neste mês” ou “No próximo mês”. Cria um lançamento único, sem “de quem” (cai em Da casa), sem recorrência e sem plano. Em conta a cópia nasce não paga.

## Cartões

Cabeçalho, soma do que falta no mês visível e **+ Cartão**. No cartão, a fatura do mês (estado, restante, pagamentos e total) vem logo depois do nome do cartão — é a primeira pergunta que importa, "quanto falta pagar". Limite, em aberto, disponível, fechamento e vencimento vêm depois, como detalhe secundário. O estado é Futura, Aberta, Fechada, Atrasada ou Paga. No cabeçalho do cartão só ficam **+** (nova compra) e o menu “⋮”; despesas associadas e evolução mensal só existem dentro do “⋮”, sem ícone próprio (evitava duas portas para a mesma ação).

**Pagar a fatura** tira o valor da conta escolhida e **não cria despesa**. O padrão é o saldo. Se o saldo é zero, o botão vira “Pagamento antecipado”. Se pagar mais, o excesso vira crédito da próxima fatura e não vira receita. Sem conta padrão, a tela já sugere a primeira conta. Pagamento parcial efetiva as compras previstas daquela fatura com data até hoje. Quando o restante chega a zero, efetiva todas as previstas. Dá para remover um pagamento; isso não devolve as compras já efetivadas. O bloco “pagamentos” soma o que foi pago e o crédito vindo da fatura anterior.

O limite comprometido soma compras efetivadas e ajustes, menos pagamentos. Compra prevista na conta não entra. Pagar a fatura libera limite na hora.

**Reajustar** muda o que não é parcela (pode ser negativo). Vira `adjustment_cents` e entra no total da fatura e no limite. Não é categoria e não entra no orçamento. Dá para desfazer. Mês sem fatura gravada, antes do fechamento, aparece como Futura. Depois do fechamento, sem compras, aparece “Sem compras”, não “Paga”. Cartão arquivado continua na lista, com “Reativar”.

A tela também tem as compras da fatura (parcelas, fixas e avulsas), o histórico de meses, a evolução e as categorias da fatura. Arquivar some da lista e guarda o histórico. Excluir, só administrador: se já houve compra, o sistema arquiva.

Mudar o dia de fechamento ou de vencimento **não reescreve** faturas já gravadas.

## Contas

A tela tem mês. Saldo atual e previsto no fim desse mês, lista de contas e, com duas ou mais, transferência. O previsto, a correção e as transferências são desse mês. Transferência não é receita nem despesa, dá para remover, e não pode ser para a mesma conta. O previsto inclui faturas ainda em aberto na conta padrão do cartão. Fatura sem conta padrão entra só no total do topo.

Nova conta: banco, tipo (corrente, poupança, dinheiro, carteira digital, investimento), saldo inicial e a data desse saldo. Movimento anterior a essa data é ignorado. Arquivar ou apagar conta é de administrador. Se a conta já foi usada, ela é arquivada.

**Corrigir fim do mês** grava o saldo que a pessoa conferiu. Não entra em receita nem despesa. Os meses seguintes enxergam esse ajuste. Dá para desfazer.

## Categorias

Despesas ou receitas, em árvore. O total da categoria principal soma as subcategorias. Dá para escolher ícone e cor. Filha sem cor própria não copia a cor do pai: a tela usa uma cor da mesma família, deslocada pelo nome. Categoria com filhas não vira filha. Se já houver lançamento, recorrência, parcela, orçamento ou filha, excluir arquiva. Senão, apaga.

## Fixas

Cada fixa gera um lançamento previsto por mês, até pelo menos dois meses à frente e no máximo 24. Uma recorrência e um mês geram no máximo um lançamento. O que foi excluído não volta.

Em conta, a data é o dia escolhido naquele mês. No cartão, a competência é o mês da fatura e a data cai dentro do ciclo.

Nesta tela, tocar a fixa abre a folha. No topo, o quadro Histórico mostra os últimos 6 meses, do mais antigo ao atual: a parte paga na cor de pago e o que ainda está em aberto mais claro. Mês sem ocorrência fica vazio. Em conta, pago é quem tem data de pagamento. No cartão, pago é a ocorrência já efetivada. Abaixo, editar mexe em valor, descrição e dia. Categoria e “de quem” mudam pela ficha do lançamento. Prevista já editada à mão não é reescrita. Encerrar pede o último mês (padrão o mês de hoje), para de gerar e apaga o previsto futuro que ninguém editou à mão. A fixa encerrada continua na lista, esmaecida. Excluir a fixa apaga o previsto a partir deste mês; o que já aconteceu fica. Pela ficha ou pelo menu do lançamento, “Esta e as seguintes” é outra ação: apaga esse mês e os posteriores, pagos ou não, e a série para ali. Não dá para trocar a conta ou o cartão da fixa por esta tela.

## Parcelamentos

Na criação, todas as parcelas nascem juntas. Em conta, a primeira cai no mês da compra e as outras avançam um mês; a primeira pode nascer paga. No cartão, todas nascem efetivadas, uma fatura por mês a partir da fatura da compra. A lista só conta como “faturada” e tira do “Falta” quando o mês da fatura já chegou.

Tocar o card abre a folha. O quadro Histórico soma as parcelas de cada um dos últimos 6 meses. A parte paga fica na cor de pago; no cartão, mês já chegado conta como pago. Cancelar o restante e Excluir ficam nessa folha. Cancelar o restante apaga, na conta, o que ainda não foi pago e, no cartão, o que ainda está em fatura que não fechou. Excluir o plano apaga todas as parcelas.

## Orçamento

Só despesa, no mês. Cada categoria pode ter um valor planejado. Vazio apaga o orçamento daquele mês. Copiar do mês anterior preenche o que ainda está vazio.

O gasto é despesa efetivada, que entra na soma, na competência do mês. Compra avulsa e parcela no cartão entram no mês da fatura, na hora, porque já nascem efetivadas. Fixa no cartão nasce prevista e só entra quando a ocorrência é efetivada. Conta só entra quando está paga. Ajuste de fatura não entra. A categoria pai soma as filhas.

A missão “ficar abaixo do orçamento” usa a soma do que foi planejado no mês. Se a mesma despesa estiver no orçamento do pai e no da filha, ela entra duas vezes nesse total do topo, porque o pai já inclui a filha.

## Metas

Nome, valor alvo, quanto já foi guardado e prazo opcional. Criar já com o valor guardado no alvo não conclui e não dá XP. Guardar ou retirar mexe só no número da meta e não tira dinheiro da conta. Não deixa retirar mais do que está guardado. Ao atingir o alvo num depósito, a meta conclui e dá 100 XP uma vez. Retirar abaixo do alvo reabre. Excluir é lógico.

## Avatar

Nível, XP e a barra até o próximo, com “Faltam X XP para o nível N”. O título acompanha o nível: Iniciante, Aprendiz, Organizado, Poupador, Investidor, Mestre das finanças. Cor e pele ficam sempre liberadas. Os itens de cabeça, rosto e pescoço travam quando o nível do item é maior que o da pessoa. Tocar de novo no item equipado tira. Salvar grava o avatar de quem está logado. Abaixo, em “O casal”, o outro membro, com título, nível e XP, só para ver. A faixa de baixo da tela cita o lançamento (10 XP) e a meta (100 XP).

O nível não é gravado. A conta é a parte inteira da raiz de XP dividido por 50, mais 1. O XP mínimo de um nível é 50 vezes o quadrado do nível anterior. Revisão da semana (20 XP, uma vez por semana) e fechamento do mês (50 XP, só mês já terminado) existem na API e nenhuma tela tem o botão. Ficar no orçamento vale 50 XP e lançar todo dia vale 100 XP, para todos os membros, também só pela API. A tela não mostra missões, sequência nem conquistas.

## Mais

Tema claro, escuro ou automático. No automático, o texto diz que segue o tema do celular ou do computador. Cada link tem uma linha de apoio: Contas e transferências, Categorias, Fixas, Parcelamentos, Orçamento, Metas, Avatar, Casa e usuários. Mostra o nome e se a pessoa é administradora ou membro. **Sair** encerra a sessão, limpa o cache e volta para a entrada.

## Casa e usuários

Administrador edita o nome da casa e o fuso. O fuso define o “hoje” dos vencimentos. A lista traz os fusos do Brasil, começando por São Paulo.

Os dois papéis lançam, pagam fatura e veem a casa. Só administrador adiciona pessoa, muda papel, redefine a senha de outra pessoa e arquiva conta ou cartão. A casa precisa de pelo menos um administrador. A própria senha troca-se com a senha atual, no mínimo 8 caracteres.

Novo membro pede nome, e-mail, senha inicial (mínimo 8) e permissão Membro ou Administrador. A lista mostra o e-mail. A própria pessoa não troca o próprio papel nessa lista.

Digital ou Face ID só aparece em HTTPS com nome, em localhost ou em 127.0.0.1, e se o navegador tiver o recurso. Em `http://IP:3003` o celular esconde a seção. A chave privada fica no aparelho. O servidor guarda o id, a chave pública e o rótulo. O navegador só guarda o id (`fin_passkey`). Dá para ativar ou desligar neste aparelho. Depois do login, a tela pode oferecer “Ativar neste celular”; “Agora não” fica gravado neste aparelho.

## Entrar e criar casa

Criar casa só aparece enquanto o cadastro está aberto (`ALLOW_REGISTER=true`). Pede nome da casa, seu nome, e-mail e senha. O botão é “Criar e entrar”. O fuso do navegador vai no pedido, sem campo na tela. Se não vier, a API usa São Paulo. O primeiro usuário vira administrador e já entra. A senha nova tem no mínimo 8 caracteres. Não há “esqueci a senha” por e-mail. O modo Entrar pede e-mail e senha.

A sessão é um cookie `fin_session`, por 30 dias, só pelo servidor, caminho `/`. Em HTTP no endereço de casa, o compose deixa `COOKIE_SECURE=false`, então o cookie funciona. Atrás de um endereço HTTPS, `COOKIE_SECURE` precisa ser `true`. Fora de casa, o túnel também precisa de `WEBAUTHN_RP_ID` (o nome, sem https) e `WEBAUTHN_ORIGIN` (a página inteira, com https).

## Onde o aplicativo roda

No computador de desenvolvimento a API usa a porta 3001 e o site o Vite na porta 5173. No NAS, `docker compose up -d --build` publica o site em `http://IP-DO-NAS:3003` (`WEB_PORT`, padrão 3003, apontando para a porta 80 do nginx). O Postgres 16 fica só na rede interna, no volume `pgdata`. O backup diário, por padrão às 3h, grava `financas-AAAAMMDD-HHMMSS.sql.gz` e apaga os que passam de `BACKUP_RETENTION_DAYS` (padrão 30). Para a digital funcionar fora de casa, o acesso precisa ser HTTPS com nome (túnel ou Tailscale), não o IP puro.

## Atualização das melhorias

- Configurar resumo usa as setas ↑ e ↓. A ordem fica em `fin-home-layout`. Há “Restaurar padrão”. A ordem padrão coloca Faturas dos cartões logo depois de Próximos vencimentos.
- Tocar numa conta em Próximos vencimentos abre a ficha na própria tela. A fatura abre o cartão, sem botão de pagar nessa lista.
- O olho oculta valores em todo o app. Em Mais há “Ocultar valores” e “Ocultar ao sair do app”.
- No celular a barra tem cinco itens: Início, Lançar, o botão +, Cartão e Ano. Mais fica no Início, à direita do olho. No computador Mais continua na coluna da esquerda, e o item ativo tem fundo verde claro.
- Lançamentos tem a situação Todos, A pagar, Vencidos e Pagos, em chips depois dos três números (não mais a faixa cheia do Tipo). A linha “Cartões de crédito” saiu da folha de resumo. No modo Eu, uma nota curta explica que a compra do cartão só vira “Pago” quando a fatura é paga.
- Novo lançamento lembra o último destino, tem Hoje, Ontem e Outra, “Lançar e novo”, categorias mais usadas, sugestão de descrição e a linha de onde o valor sai ou entra. No parcelado, Cada parcela começa selecionado, à esquerda de Valor total. No celular, Lançar fica em cima e Lançar e novo embaixo.
- Na fixa e no parcelamento em conta, mudar o dia pergunta “Só esta” ou “Esta e as seguintes”. O mês fica; o dia novo entra nas seguintes, mesmo nas já pagas. O valor novo não mexe no que já foi pago. Excluir na ficha e no menu usa as mesmas duas opções para a fixa e para a parcela.
- Cartões mostram “vence em N dias”, o melhor dia de compra, alerta de limite, o valor no botão de pagar e o menu em folha.
- A visão anual abre com um mês no celular e tem “Ver todos os meses”. Editar um lançamento não joga a rolagem de volta para o mês atual.
- O calendário lista os próximos 7 dias do mês visto e marca o dia atrasado.
- O orçamento mostra quanto resta, fica de alerta a partir de 80% e estima o fechamento do mês corrente.
- Metas têm depósito rápido, edição e “guarde X por mês”.
- Mais está em Planejamento, Cadastros e Casa, com exportação CSV.
- Deslizar para o lado troca o mês em Lançamentos, Calendário, Contas, Cartões e Orçamento.
- Instalar na tela inicial exige HTTPS com nome. O service worker guarda a casca e não guarda a API. Sem rede, a faixa diz “Sem conexão”.
- Avisos no celular também exigem HTTPS com nome e as chaves VAPID no servidor. O texto só diz que há vencimentos, sem valor. A situação de um lançamento é `paid`, `overdue`, `near` (até 7 dias) ou `planned`. A compra no cartão segue o vencimento da fatura. Em Próximos vencimentos, a conta traz o id do lançamento.
- Revisão de Lançamentos, Cartões e Ano: título e valor de cada linha ficam ligados por uma linha pontilhada (Próximos vencimentos do Início e a lista de Lançamentos); o nome da conta não se repete mais em cada linha, só no cabeçalho do grupo; o cartão mostra a fatura antes do limite; a situação de Lançamentos virou chips depois dos números; a visão anual ganhou o gráfico do Início no topo e corrigiu as cores dos cabeçalhos de seção e da linha Saldo (seguiam sempre verdes). No Resumo do Início, “Orçamento” estava comparando o já pago com o que falta pagar no mês (dois números de fluxo de caixa) em vez do teto de orçamento de verdade; agora usa o valor real de `/orçamento` e mostra o percentual.


