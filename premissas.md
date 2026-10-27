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

Início, Lançamentos, Calendário e Ano abrem em **Eu**. A escolha vale a sessão inteira, nas quatro telas, e não fica gravada no aparelho. Recarregar volta para Eu. A faixa é a mesma nas quatro: Eu e Nós dividem a largura da coluna.

- **Eu** mostra só o que tem `for_user_id` de quem está logado. O que está “Da casa” (`for_user_id` vazio) fica de fora.
- **Nós** não filtra. Entram as duas pessoas e o que é da casa. Nós é a casa inteira, não só “Da casa”.

No lançamento, “De quem” lista o primeiro nome de cada pessoa e o chip Da casa. O padrão é quem está logado.

Isto continua da casa inteira, mesmo em Eu:

- saldo atual e previsto das contas;
- lista de cartões, limite e faturas;
- bloco de faturas do Início;
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

**Conta.** A competência é o mês da data. Se a data é hoje ou já passou, ou se a pessoa marcou como pago, nasce efetivado e com data de pagamento. Senão nasce previsto. Pagar ou receber abre a folha Efetivar: valor, data de pagamento, vencimento e conta. Mudar valor ou conta nessa hora vale só para esta ocorrência. Desfazer o pagamento devolve a linha para previsto.

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

Na fixa e no parcelamento em conta, mudar o valor ou o dia pergunta se vale só para esta ou também para as seguintes. O mês não muda. O dia novo entra nas seguintes, mesmo nas já pagas. O valor novo não mexe no que já foi pago. Descrição, categoria e de quem mudam só a ocorrência aberta. No cartão a data segue a fatura.

## Transferência e dinheiro que sai da casa

Transferência move saldo entre duas contas do aplicativo. Não é receita nem despesa, e o total da casa não muda. Não serve para registrar um PIX para quem não usa o app.

Dinheiro que sai para fora da casa é uma despesa paga, na conta de quem pagou, com “Contar na soma” desligado quando esse valor não deve entrar nas despesas do mês nem no orçamento. O saldo da conta cai do mesmo jeito. Não vira dívida e não fica como “a pagar”.

**Corrigir fim do mês** grava o saldo conferido naquela conta. Não é receita nem despesa. Os meses seguintes enxergam o ajuste.

## Orçamento, metas e avatar

O orçamento é só de despesa, no mês, e o teto é da casa inteira. O gasto comparado pode estar filtrado por Eu ou Nós. Entra despesa efetivada que conta na soma, na competência do mês. Compra e parcela no cartão entram no mês da fatura porque já nascem efetivadas. Fixa no cartão entra quando a ocorrência é efetivada. Conta entra quando está paga. Ajuste de fatura não entra.

Meta guarda um número. Guardar ou retirar não tira dinheiro da conta. Atingir o alvo numa entrada conclui a meta e dá 100 XP uma vez. Retirar abaixo do alvo reabre. Criar já no alvo não conclui e não dá XP.

Lançamento avulso, criar uma fixa e criar um parcelamento valem 10 XP uma vez cada. O parcelamento dá o XP no plano, não em cada parcela. O nível não é gravado: é a parte inteira da raiz de XP dividido por 50, mais 1. Revisão da semana, fechamento do mês, ficar no orçamento e lançar todo dia existem na API e nenhuma tela tem o botão.

## O que fica neste aparelho

- Tema claro, escuro ou automático (`fin-theme`).
- Olho de ocultar valores (`fin-hide-money`) e ocultar ao sair do app. O botão fica no Início, à direita dos avatares; em Mais há os mesmos controles. Ligado, os valores marcados somem no aplicativo inteiro.
- Ordem e visibilidade dos cards do Início (`fin-home-layout`).
- A oferta de digital ou Face ID dispensada com “Agora não”.
- Eu / Nós e o mês visto não ficam no aparelho. O mês vale entre Início, Lançamentos, Calendário, Cartões, Contas e Orçamento na mesma sessão. O Ano abre sempre no ano de hoje.

## Acesso

Entrar pede e-mail e senha. A sessão é o cookie `fin_session`, por 30 dias, só pelo servidor. Em HTTP no endereço de casa, `COOKIE_SECURE=false`. Atrás de HTTPS, `COOKIE_SECURE=true`.

Digital e Face ID exigem página HTTPS com nome (não um IP puro). A chave privada fica no aparelho. O servidor guarda o id, a chave pública e o rótulo. O login em si continua sendo e-mail e senha; a digital se ativa em Casa e usuários, ou na oferta depois do login. Fora de casa, o túnel precisa de `WEBAUTHN_RP_ID` (o nome, sem https) e `WEBAUTHN_ORIGIN` (a página inteira, com https).

O fuso da casa define o “hoje” dos vencimentos. O padrão é `America/Sao_Paulo`.

## Onde roda

No computador de desenvolvimento, a API usa a porta 3001 e o site o Vite na 5173. No NAS, o Docker publica o site na porta 3003. O Postgres fica só na rede interna. O backup diário guarda o dump e apaga os que passam da retenção.

Fora de casa o acesso é por túnel (Cloudflare ou Tailscale), não por porta aberta no roteador. Instalar na tela inicial e avisos de vencimento também pedem HTTPS com nome. O aviso diz que há vencimento e não mostra valor.

## O que fica de fora

- Encargos, calculadora e anexo no pagamento.
- Trocar o cartão na edição de um lançamento.
- Recuperação de senha por e-mail.
- Convite entre duas casas na interface.
- Missões, sequência e conquistas na tela, embora parte do XP exista na API.
- Várias casas no mesmo uso do dia a dia.
