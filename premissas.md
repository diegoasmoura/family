# Premissas · Finanças do casal

Este texto fixa as decisões de produto que o aplicativo segue hoje. O detalhe de cada tela, o cálculo de saldo e a largura no celular e no computador estão em `sistema.md`. O que mudou na interface depois de uma melhoria entra lá; o que não pode ser reinterpretado fica aqui.

## Para quem é

O aplicativo é de um casal, Diego e Jhersyka, para responder numa olhada:

- quanto tem nas contas agora;
- quanto já entrou e saiu neste mês;
- quanto ainda vai entrar e sair;
- o que o cartão já comprometeu;
- como o mês e o ano vão fechar.

Não é um banco, não é contabilidade e não é um app de várias famílias. A casa é uma só.

## A casa

As duas pessoas são membros da mesma casa e entram com o próprio e-mail e senha. A segunda pessoa é adicionada em Casa e usuários. Não há convite entre duas casas na interface: esse código existe no repositório, mas a API não o publica.

O primeiro usuário, criado em Criar casa, vira administrador. Enquanto o cadastro está aberto (`ALLOW_REGISTER=true`), outra pessoa ainda pode criar outra casa. Depois que as duas existem, o cadastro fecha (`ALLOW_REGISTER=false`).

Os dois papéis lançam, pagam fatura e veem a casa. Só o administrador adiciona pessoa, muda papel, redefine a senha de outra pessoa e arquiva conta ou cartão. A casa precisa de pelo menos um administrador. A própria pessoa não muda o próprio papel na lista.

Não há “esqueci a senha” por e-mail. A senha nova tem no mínimo 8 caracteres. Cada um troca a própria senha com a senha atual. O administrador redefine a senha de um membro.

## Eu, Nós e da casa

Início, Lançamentos, Calendário e Ano abrem em **Eu**. A escolha vale a sessão inteira e não fica gravada no aparelho. Recarregar volta para Eu. A faixa é a mesma: Eu e Nós dividem a largura da coluna. A aba Cartões não tem essa faixa.

- **Eu** mostra só o que tem `for_user_id` de quem está logado. O que está “Da casa” (`for_user_id` vazio) fica de fora.
- **Nós** não filtra. Entram as duas pessoas e o que é da casa. Nós é a casa inteira, não só “Da casa”.

No lançamento, “De quem” lista o primeiro nome de cada pessoa e o chip Da casa. O padrão é quem está logado.

O cartão também tem titular, no “De quem”, e só pode ser de uma pessoa: Diego ou Jhersyka. Não existe Da casa no cartão. A aba Cartões não tem Eu/Nós e mostra só o cartão de quem está logado, mesmo quando o resto do app está em Nós. O cartão da outra pessoa não entra nessa aba. No carrossel do Início e na escolha ao lançar, o Eu mostra só o titular e o Nós mostra o cartão de cada um. Pagar a fatura continua saindo da conta da casa.

Isto continua da casa inteira, mesmo em Eu:

- saldo atual e previsto das contas;
- vencimento de fatura nos próximos 30 dias;
- contas, transferências, orçamento (o teto) e metas.

O avatar do Início segue o filtro: em Eu só o de quem está logado; em Nós os dois.

## Dinheiro

O dinheiro é sempre um número inteiro de centavos. A tela formata em reais (`R$ 1.234,56`).

Parcelas dividem o total em centavos inteiros. O resto de 1 centavo fica nas primeiras. R$ 100,00 em 3 vezes vira 33,34 + 33,33 + 33,33. O total parcelado precisa ter pelo menos 1 centavo por parcela.

`include_in_reports` desligado deixa o lançamento na lista, esmaecido, e tira do total do mês, do ano, do orçamento e dos gráficos. Continua na fatura e no saldo da conta, porque despesa já efetivada mexe no saldo. O padrão é somar.

Excluir é lógico: o registro some da tela e o histórico de exclusão fica no banco. O que foi excluído não volta a ser gerado.

## Conta e cartão são coisas diferentes

Receita não entra em cartão.

**Dízimo.** Receita pode entrar no dízimo. A opção começa marcada, e o que já estava lançado também entra. Dez por cento, em centavos arredondados, vira uma despesa prevista na mesma conta, com vencimento no dia 30 do mês da receita. Fevereiro usa o último dia. Essa despesa não nasce paga. A categoria é Reino, subgrupo Geral. O que já estava lançado vira uma despesa por pessoa em cada mês, com dez por cento da soma daquela pessoa, na conta que mais recebeu. Receita da casa fica numa despesa da casa. Receita lançada depois disso ganha a própria despesa e não entra de novo nessa soma. Mudar o valor atualiza o dízimo se ele ainda não foi pago. Desmarcar ou excluir a receita apaga o dízimo em aberto. O que já foi pago fica.

**Conta.** A competência é o mês da data. Se a data é hoje ou já passou, ou se a pessoa marcou como pago, nasce efetivado e com data de pagamento. Senão nasce previsto. Pagar ou receber abre a folha Efetivar: valor, data de pagamento, vencimento e conta. Na despesa, se a data de pagamento passa do vencimento, a folha avisa o atraso e oferece encargos. A soma do valor com os encargos vale só para esta ocorrência e é o que sai da conta. Encargos em zero não mudam o valor. Desfazer o pagamento devolve a linha para previsto e mantém o valor já somado.

**Cartão.** Compra avulsa ou parcela nasce efetivada na fatura, sem data de pagamento. Ela só fica “paga” quando a fatura quita. Cobrança fixa no cartão nasce prevista até alguém confirmar a ocorrência. Compra de cartão não usa a folha Efetivar: a quitação é a fatura. O menu só confirma a compra ainda prevista.

Pagar a fatura tira o valor da conta e não cria despesa. Pagar a mais vira crédito da próxima fatura e não vira receita. Pagamento parcial efetiva as compras previstas daquela fatura com data até hoje. Quando o restante chega a zero, efetiva todas as previstas. Remover um pagamento não devolve as compras já efetivadas.

Não dá para trocar o cartão de uma compra, nem levar uma compra do cartão para uma conta, nem o contrário. Mudar o dia de fechamento ou de vencimento não reescreve faturas já gravadas.

Fechamento: compra antes do dia de fechamento entra na fatura daquele mês. No dia do fechamento ou depois, entra na seguinte. Se o vencimento é maior que o fechamento, a fatura vence no mesmo mês em que fecha. Se o vencimento é menor ou igual, vence no mês seguinte. Dia 31 em mês curto vira o último dia.

## Competência, realizado e previsto

A lista e a visão anual usam o mês de competência, não o dia em que a pessoa abriu a tela.

- Conta a pagar entra no mês do vencimento quando a recorrência ou a parcela já nasceu com esse vencimento. Lançamento avulso com vencimento noutro mês cai no mês da data.
- Compra no cartão entra no mês da fatura.
- **Realizado**, na visão anual, inclui o que já foi lançado e também a conta que ainda está a pagar. A célula fica verde e em negrito só quando o valor inteiro já foi pago ou recebido. Parte paga fica na cor normal.
- **Previsto** acrescenta o que ainda é só previsão no cartão.

O estado da linha (Pago, Atrasado, Próximo, Previsto) é calculado, não gravado. Sem pagamento, vencido é atrasado. De hoje até 7 dias é próximo. Depois disso é previsto.

## O que se repete

**Fixa.** Uma recorrência e um mês geram no máximo um lançamento, até pelo menos dois meses à frente e no máximo 24. Prevista já editada à mão não é reescrita. Encerrar para de gerar e apaga o previsto futuro que ninguém editou. Excluir a série apaga o previsto a partir deste mês; o que já aconteceu fica. Pela ficha, “Esta e as seguintes” apaga o mês aberto e os posteriores, pagos ou não, e a série para ali.

**Parcelamento.** Na criação, todas as parcelas nascem juntas. Em conta, a primeira cai no mês da compra e pode nascer paga. No cartão, todas nascem efetivadas, uma fatura por mês. Receita não parcela. Cancelar o restante apaga, na conta, o que ainda não foi pago e, no cartão, o que ainda está em fatura que não fechou.

Na fixa e no parcelamento em conta, mudar o valor ou o dia pergunta se vale só para esta ou também para as seguintes. O mês não muda. O dia novo entra nas seguintes, mesmo nas já pagas. O valor novo não mexe no que já foi pago. Na fixa, descrição, categoria e de quem mudam só a ocorrência aberta. No parcelamento, o nome e a quantidade mudam em todas as parcelas, pagas ou não. Categoria e de quem continuam só na ocorrência aberta. No cartão a data segue a fatura.

A quantidade nova acrescenta parcelas depois da última, cada uma com o valor da última. Em conta, a data segue o dia da última, mês a mês. No cartão, cada parcela nova cai na fatura seguinte do plano. Reduzir a quantidade tira as que passam do número, só se ainda estiverem em aberto: em conta, não pagas; no cartão, em fatura que ainda não fechou. O total gravado no plano passa a ser a soma das parcelas que ficam.

**Contrato (financiamento ou empréstimo).** É um parcelamento em conta marcado como contrato, não um segundo sistema: cada prestação continua sendo uma despesa normal do mês, com as mesmas regras do parcelamento, e por isso não conta duas vezes em lugar nenhum. A aba Contratos só mostra esses parcelamentos de outro jeito (quanto falta, em que parcela está, quando termina). O dinheiro do empréstimo que cai na conta sobe o saldo, mas não é receita do mês, como uma transferência. Compra parcelada no cartão não é contrato.

Quando a prestação é dividida, cada prestação vira uma linha por pessoa, cada uma com a parte dela e com a conta de onde essa parte sai. No Eu entra só a linha de quem está logado. No Nós as duas somam a prestação. O plano guarda uma conta só, a da primeira pessoa, porque o cadastro exige uma; o saldo usa a conta da linha. Mudar a divisão ou a conta reescreve as prestações em aberto; as já pagas ficam como estão. No contrato não existe “Da casa”: é de uma pessoa ou dividido. Compra no cartão não se divide assim.

Uma pessoa pode quitar sozinha todas as partes ainda abertas de uma prestação dividida, inclusive antes do vencimento. Isso não muda a responsabilidade: a parte continua sendo de quem era e o histórico separa **de quem é** de **quem pagou**. O total sai da conta escolhida por quem paga. A competência e o vencimento não mudam; a data informada é a data efetiva do pagamento. O valor realmente cobrado é informado manualmente e repartido pela divisão da prestação; desconto ou acréscimo muda só essa prestação, entra em Poupado/A mais e não recalcula Price, SAC nem as seguintes. Desfazer restaura a quitação inteira, nunca apenas uma das linhas.

O total gravado na criação do parcelamento não muda quando o valor de uma parcela em aberto muda. Poupado é esse total menos a soma das parcelas que ainda existem, e só conta quando nenhuma foi cancelada. Se a soma ficou maior, é “a mais”. Juros de atraso entram na quitação, pelo valor realmente cobrado: a diferença reduz o poupado e, se a soma passar do total da criação, o rótulo vira “a mais”. Cada quitação seguinte recalcula esse número. A lista não reescreve o valor de parcela já paga.

## Transferência e dinheiro que sai da casa

Transferência move saldo entre duas contas do aplicativo. Não é receita nem despesa, e o total da casa não muda. Não serve para registrar um PIX para quem não usa o app.

Dinheiro que sai para fora da casa é uma despesa paga, na conta de quem pagou, com “Contar na soma” desligado quando esse valor não deve entrar nas despesas do mês nem no orçamento. O saldo da conta cai do mesmo jeito. Não vira dívida e não fica como “a pagar”.

**Corrigir fim do mês** grava o saldo conferido naquela conta. Não é receita nem despesa. Os meses seguintes enxergam o ajuste.

## Orçamento, metas e avatar

O orçamento é só de despesa, no mês, e o teto é da casa inteira. O gasto comparado pode estar filtrado por Eu ou Nós. Entra despesa efetivada que conta na soma, na competência do mês. Compra e parcela no cartão entram no mês da fatura porque já nascem efetivadas. Fixa no cartão entra quando a ocorrência é efetivada. Conta entra quando está paga. Ajuste de fatura não entra.

Meta guarda um número. Guardar ou retirar não tira dinheiro da conta. Atingir o alvo numa entrada conclui a meta. Retirar abaixo do alvo reabre. Criar já no alvo não conclui.

O avatar é um quadrado. Sem desenho escolhido, mostra as iniciais do nome numa cor entre doze tons. O desenho é um dos catorze do DiceBear, os mesmos do Dihan: sete Open Peeps e sete Big Smile. A tela do avatar escolhe o desenho e a cor. Lançamento, fixa, parcelamento e meta não dão ponto.

## O que fica neste aparelho

- Tema claro, escuro ou automático (`fin-theme`).
- Olho de ocultar valores (`fin-hide-money`) e ocultar ao sair do app. O botão fica no Início, à direita dos avatares; em Mais há os mesmos controles. Ligado, os valores marcados somem no aplicativo inteiro.
- Ordem e visibilidade dos cards do Início (`fin-home-layout`).
- Ordem e grupos recolhidos do Extrato (`fin-extrato-groups`).
- A oferta de digital ou Face ID dispensada com “Agora não”.
- Eu / Nós e o mês visto não ficam no aparelho. O mês vale entre Início, Lançamentos, Calendário, Cartões, Contas e Orçamento na mesma sessão. O Ano abre sempre no ano de hoje.

## Acesso

O nome visível, no ícone e na tela de entrar, é **Diário**.

Entrar pede e-mail e senha. A sessão é o cookie `fin_session`, por 30 dias, só pelo servidor. Em HTTP no endereço de casa, `COOKIE_SECURE=false`. Atrás de HTTPS, `COOKIE_SECURE=true`.

Abrir a página, recarregar ou voltar do segundo plano pede de novo a digital deste celular ou a senha, antes de mostrar qualquer aba. A sessão de 30 dias continua. Navegar entre as telas não pede.

Digital e Face ID exigem página HTTPS com nome (não um IP puro). A chave privada fica no aparelho. O servidor guarda o id, a chave pública e o rótulo. A digital se ativa em Casa e usuários, ou na oferta depois do login. Sem ela, o cadeado pede a senha. Fora de casa, o túnel precisa de `WEBAUTHN_RP_ID` (o nome, sem https) e `WEBAUTHN_ORIGIN` (a página inteira, com https).

O fuso da casa define o “hoje” dos vencimentos. O padrão é `America/Sao_Paulo`.

## Onde roda

No computador de desenvolvimento, a API usa a porta 3001 e o site o Vite na 5173. No NAS, o Docker publica o site na porta 3003. O Postgres fica só na rede interna. O backup diário guarda o dump e apaga os que passam da retenção.

Fora de casa o acesso é por túnel (Cloudflare ou Tailscale), não por porta aberta no roteador. Instalar na tela inicial e avisos de vencimento também pedem HTTPS com nome. O aviso diz que há vencimento e não mostra valor.

## O que fica de fora

- Calculadora e anexo no pagamento.
- Trocar o cartão na edição de um lançamento.
- Recuperação de senha por e-mail.
- Convite entre duas casas na interface.
- Missões, sequência e conquistas na tela.
- Várias casas no mesmo uso do dia a dia.
