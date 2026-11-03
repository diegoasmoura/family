# Captura de compras do cartão (Open Finance, Pluggy, notificações)

Nota de pesquisa de 3 de novembro de 2026. Não é regra de produto: `premissas.md` continua valendo. O app ainda não integra banco nenhum. Preços e prazos abaixo são os publicados nessa data e podem mudar.

## O que o app é hoje

Finanças do casal é um site (PWA em React, API Express no NAS). Não é aplicativo nativo. Por isso ele não lê o alerta do Nubank, do Itaú ou do Inter, nem no Android nem no iPhone.

Quem lê a notificação de outro aplicativo no Android é um app nativo, com a permissão de acesso às notificações (`NotificationListenerService`), depois que a pessoa liga isso nas configurações. No iPhone não existe API equivalente: um app não observa a notificação de outro.

## Como o Minhas Finanças faz

O app Minhas Finanças (na App Store, “My Finances”, [minhasfinancas.app.br](https://minhasfinancas.app.br/)) usa a **Pluggy** no Open Finance. A ajuda deles diz isso em [Conectar um banco pelo Open Finance](https://minhasfinancas.app.br/ajuda/conectar-open-finance): a Pluggy acessa o que a pessoa autorizou no banco (contas, cartões, saldos, faturas e transações). É só leitura. Está nos planos pagos Sync Bank e Sync Bank Pro.

Esse app tem mais de um caminho:

- **Open Finance via Pluggy paga.** Atualiza ao longo do dia. O próprio site avisa que a compra pode levar algumas horas ou, em alguns bancos, até 5 dias. O prazo é do banco, não do celular.
- **Notificação e SMS no Android.** [Importar notificações bancárias e SMS](https://minhasfinancas.app.br/ajuda/importar-notificacoes-sms). O alerta do banco vira lançamento na hora. Se a conta ou o cartão já está no Open Finance, essa leitura vem desligada, para não duplicar. Dá para religar em Configurações, Open Finance, “Permitir importação de notificações”. No Android 15 o banco pode marcar o alerta como sensível e esconder o texto dos outros apps.
- **iPhone.** Não lê notificação de banco. A ajuda cita importar pagamento por aproximação com o app Atalhos. O automático de verdade no iPhone, nesse app, é o Open Finance.

Uma compra do Nubank que “chegou na hora” no Minhas Finanças é a notificação do Android, ou o Nubank publicando rápido na Pluggy paga. Não é o ritmo do plano gratuito.

## Pluggy: pago e gratuito

A Pluggy (CNPJ 37.943.755/0001-30) é autorizada pelo Banco Central como iniciadora de transação de pagamento. O NAS não fala direto com o Banco Central. Ser participante exige instituição, certificação e segurança; não é uma mensalidade de site.

Preços publicados em [pluggy.ai/precos](https://www.pluggy.ai/precos) nessa data:

- **Dados**, a partir de R$ 2.500/mês, até 500 conexões. É o produto que lê conta, extrato, cartão e investimento, com webhook. Teste de 15 dias em produção, sem cartão. Acima do volume incluso, cobra por requisição. O mínimo é de produto: duas pessoas pagam o mesmo piso que um app com centenas de clientes.
- **Pagamentos**, a partir de R$ 500/mês. É Pix. Não lê compra de cartão.

A [Belvo](https://belvo.com/pt-br/planos-precos/) publicava Launch a R$ 1.500/mês, restrito a fintech, banco, crédito, proptech, imobiliário e telecom. A página diz que uso pessoal não é atendido.

### Meu Pluggy (grátis, uso pessoal)

[Meu Pluggy](https://pluggy.ai/meu-pluggy) é gratuito, sem prazo, para as próprias contas: planilha, agente ou ferramenta pessoal self-hosted. Não atende produto em que outras pessoas (clientes) conectam o banco. Esse caso é a API paga.

Passos, do site deles: criar conta em meu.pluggy.ai, autorizar cada banco até o fim (a conta só existe se aparecer com saldo), criar aplicação no dashboard.pluggy.ai, copiar Client ID e Client Secret, e no seletor escolher o conector **MeuPluggy** — não o Nubank, o Itaú nem o Sandbox. Banco novo no Meu Pluggy precisa ser vinculado de novo à aplicação.

Limites que importam para esta casa:

- A [documentação](https://docs.pluggy.ai/pt/docs/guides/meu-pluggy-personal-use) descreve até 5 conexões e atualização **uma vez por dia**. O item pessoal não se atualiza na hora. A compra do Nubank tende a aparecer no dia seguinte, não quando o celular apita.
- O [FAQ](https://docs.pluggy.ai/pt/docs/get-started/faq) diz que novas transações de Open Finance podem levar até 24 horas. “Até 24 horas” é o teto, não a promessa de instante.
- A mesma FAQ responde: uma conta do Meu Pluggy pode ter bancos de titulares diferentes? **Hoje, sim.** A Jhersyka autoriza os bancos dela, com o CPF dela. Isso está em revisão de compliance e pode ser cortado, sem data. Dá para usar. Não dá para tratar como regra permanente.
- O consentimento da aplicação dura um ano (`consentExpiresAt`) e precisa ser renovado.
- Client ID e Client Secret dão acesso aos extratos. Ficam só no servidor, nunca no navegador nem no git.

## O que falta neste repositório

Não há cliente Pluggy, consentimento nem importação de extrato bancário. Exportar CSV em Mais não é o caminho de volta.

Se isso for construído um dia, a compra entra como sugestão da casa, não como despesa. Alguém confirma. Aí valem as regras que já existem: compra de cartão nasce na fatura, sem data de pagamento; no dia do fechamento ou depois vai para a fatura seguinte; parcelamento cria todas as parcelas; pagar a fatura não é despesa. O cartão se escolhe pelo final. A mesma compra pode chegar pela notificação e pelo extrato: a chave é instituição, cartão, valor em centavos, dia e estabelecimento. Id estável da Pluggy ganha do texto do alerta.

Ordem que faz sentido para uma casa só, sem mensalidade: extrato OFX ou CSV com fila de confirmação; Meu Pluggy se aceitarem o atraso de um dia e a Pluggy no meio; notificação só com um app Android mínimo, se a pressa do alerta importar. A Pluggy de R$ 2.500/mês é o jeito de ter no iPhone o mesmo automático do Minhas Finanças.
