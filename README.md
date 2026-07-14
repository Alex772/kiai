# Kiai Discord Shop Bot

Bot Discord para gerenciar uma loja com pagamentos em dinheiro real via PIX usando Mercado Pago, preparado para hospedagem no Railway.

## Funcionalidades

- `/loja`: mostra os produtos com paginação (botões Anterior/Próxima e um botão "Página X/Y" que abre um campo pra digitar a página desejada) e botão "Comprar" em cada um.
- `/comprar`: mostra a escolha entre PIX e cartão de crédito/débito, depois cria o pedido e gera o pagamento na forma escolhida.
- `/pedido`: consulta o status detalhado de um pedido (valor, ID do pagamento no Mercado Pago, cargo de entrega, datas).
- `/pedidos`: lista os últimos pedidos do usuário.
- `/meusbeneficios`: mostra seus cargos ativos e o tempo restante até cada um expirar.
- `/usuario` (moderador/admin): consulta o histórico de pedidos e os benefícios ativos de qualquer pessoa.
- `/addproduto`: adiciona um produto (ID é gerado automaticamente pelo banco; você pode escolher a posição na lista, um cargo do Discord pra entregar automaticamente, e por quanto tempo esse cargo fica ativo).
- `/editarproduto`: mostra a lista de produtos num menu — ao escolher um, abre uma tela com todos os dados do produto, um botão pra editar nome/preço/descrição/entrega/posição (via formulário), um seletor de cargo, e um botão pra definir a duração do cargo (temporário ou permanente).
- `/removerproduto`: remove um produto da loja (os produtos seguintes reordenam automaticamente pra fechar o espaço).
- `/lojaconfig`: configura título, descrição e quantidade de itens por página da loja. Sem argumentos, mostra a configuração atual.
- `/permissoes`: define quais cargos podem administrar a loja (veja a seção "Permissões" abaixo). Sem argumentos, mostra a configuração atual.
- `/logs`: define os canais de log da loja (veja a seção "Logs" abaixo). Sem argumentos, mostra a configuração atual.
- Webhook `POST /webhooks/mercado-pago`: recebe notificações do Mercado Pago, confirma a assinatura, e libera a entrega (cargo + DM) quando o pagamento for aprovado.
- Healthcheck `GET /health` para Railway.
- Registro automático dos comandos slash ao iniciar (`AUTO_REGISTER_COMMANDS=true` por padrão).
- Tratamento de erro nas interações para o Discord não ficar preso em "pensando..." se o Mercado Pago recusar a requisição.

> Se as variáveis obrigatórias ainda não estiverem configuradas, o processo não derruba o Railway: ele sobe apenas o servidor HTTP, mostra as variáveis faltantes em `/health` e só conecta o bot ao Discord quando `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` e `MERCADO_PAGO_ACCESS_TOKEN` existirem.

## Permissões

Por padrão, só o **dono do servidor** consegue usar os comandos administrativos. Use `/permissoes` (dono do servidor apenas — de propósito, pra ninguém conseguir se dar mais acesso sozinho) pra configurar dois cargos:

- **Cargo admin** (`cargo_admin`): acesso total — configura a loja (`/lojaconfig`) e gerencia produtos (`/addproduto`, `/editarproduto`, `/removerproduto`).
- **Cargo moderador** (`cargo_moderador`): acesso limitado — só gerencia produtos, não pode mexer em `/lojaconfig` nem em `/permissoes`.

Exemplos:
```
/permissoes cargo_admin:@Gerente da Loja
/permissoes cargo_moderador:@Atendente
/permissoes remover_moderador:true
/permissoes            (sem argumentos → mostra a configuração atual)
```

A variável de ambiente `ADMIN_ROLE_ID` continua funcionando como um fallback (equivalente ao cargo admin), mas o recomendado agora é usar `/permissoes`.

## Entrega automática de cargo do Discord

Cada produto pode ter um cargo do Discord vinculado, entregue automaticamente assim que o pagamento é aprovado (via webhook ou pelo botão "Verificar pagamento") — além da mensagem de entrega em texto.

- Ao criar um produto: use a opção `cargo` em `/addproduto`.
- Em um produto já existente: `/editarproduto` → escolha o produto → use o seletor "Escolher cargo de entrega" (ou o botão "Remover cargo de entrega" pra tirar).

**Importante:** para o bot conseguir atribuir o cargo, ele precisa:
1. Ter a permissão **Gerenciar Cargos** (Manage Roles) no servidor.
2. Ter o cargo do bot posicionado **acima**, na lista de cargos do servidor, do cargo que ele vai entregar (regra do próprio Discord — um bot nunca pode atribuir um cargo mais alto que o dele).

Se a atribuição falhar (permissão faltando, hierarquia errada, etc.), o bot não trava a compra: a mensagem de entrega em texto ainda é enviada por DM, com um aviso pedindo pra um administrador liberar o cargo manualmente, e o erro completo fica no log do Railway.

## Cargo temporário (expiração automática)

Cargos de entrega podem ter prazo de validade — ideal pra assinaturas tipo "VIP por 30 dias".

- Ao criar: use `duracao_cargo` em `/addproduto` junto com `cargo` (ex: `30 dias`, `1 mes`, `1 ano`, `12 horas`).
- Em um produto já existente: `/editarproduto` → escolha o produto → botão "⏱️ Definir duração do cargo". Deixe o campo vazio pra tornar permanente de novo.
- Formatos aceitos: `<número> <unidade>`, com ou sem espaço — `minuto(s)`, `hora(s)`, `dia(s)`, `semana(s)`, `mes(es)`, `ano(s)`. Ex: `7dias`, `2 semanas`, `1mes`, `1 ano`.

O prazo começa a contar **a partir do momento em que o cargo é entregue** (pagamento aprovado), não da criação do pedido. A cada 5 minutos, o bot verifica quem já passou do prazo, remove o cargo automaticamente, avisa a pessoa por DM, e registra o evento nos dois canais de log (`/logs`).

Comandos relacionados:
- `/meusbeneficios` — qualquer usuário vê os próprios cargos ativos e quanto tempo falta pra cada um.
- `/usuario` (moderador/admin) — consulta o histórico de pedidos e os benefícios ativos de qualquer pessoa do servidor.

## Pagamento com cartão de crédito/débito

Ao clicar em "Comprar" (pela `/loja` ou `/comprar`), a pessoa escolhe entre **PIX** ou **Cartão de crédito/débito**.

Para cartão, o bot **nunca coleta número de cartão, CVV ou validade** — isso seria um risco sério de segurança (PCI-DSS) e o bot não faz isso de propósito. Em vez disso, ele gera um link do **Checkout Pro** do Mercado Pago: uma página segura hospedada pelo próprio Mercado Pago, onde a pessoa digita os dados do cartão. O bot só recebe a confirmação de aprovado ou não, do mesmo jeito que já acontece com o PIX (webhook + verificação automática).

Diferenças em relação ao PIX:
- Não existe QR Code — o botão "Abrir pagamento seguro" leva direto pra página do Mercado Pago.
- O ID do pagamento só é conhecido depois que a pessoa termina o checkout (não na hora de gerar o link), então o bot usa uma busca por `external_reference` pra descobrir e confirmar o pagamento — tanto no webhook quanto na verificação automática periódica.
- Parcelamento, bandeiras aceitas e taxas seguem as regras normais da conta Mercado Pago conectada; o bot não interfere nisso.

Isso exige `PUBLIC_BASE_URL` configurado (mesma variável já usada pelo webhook do PIX) — sem ela, o botão "Cartão" ainda aparece, mas a criação do link falha com um aviso claro pedindo pra configurar a variável.

**Atenção:** nos testes, o Checkout Pro não ofereceu a opção de "pagar como convidado" — pediu login/cadastro Mercado Pago mesmo pra quem nunca teve conta. O bot já avisa isso no texto pro comprador ("requer conta Mercado Pago"). Isso é uma configuração/comportamento da conta Mercado Pago conectada, não algo controlável pela nossa integração — se quiser investigar, veja em "Seu negócio → Configurações → Checkouts" no painel do Mercado Pago, ou fale com o suporte deles. O PIX não tem essa limitação.

## Logs

Use `/logs` (dono do servidor apenas) pra configurar dois canais de texto separados:

- **`canal_vendas`** — histórico de vendas/compras: todo pedido criado, todo pagamento aprovado, e pedidos que expiraram sem pagamento. Serve como registro público (dentro do servidor) de quem comprou o quê e quando pagou.
- **`canal_admin`** — log administrativo sensível: toda alteração feita por quem tem acesso de moderador/admin — produto adicionado/editado/removido, cargo de entrega alterado, configuração da loja mudada, permissões alteradas, canais de log alterados. Serve como trilha de auditoria pra pegar qualquer uso indevido do acesso concedido.

Exemplos:
```
/logs canal_vendas:#vendas-log canal_admin:#admin-log
/logs remover_vendas:true
/logs            (sem argumentos → mostra a configuração atual)
```

**Importante sobre o canal admin:** o bot só posta as mensagens nesse canal — ele não controla quem consegue ver o canal. Como esse log tem dados sensíveis (é justamente o mecanismo pra pegar abuso de permissão), configure as permissões desse canal no próprio Discord pra que só o dono do servidor (ou quem for de extrema confiança) consiga vê-lo. Sem isso, um moderador mal-intencionado poderia ver o log que deveria justamente vigiar as ações dele.

Nenhum dos dois canais é obrigatório — sem configurar, o bot simplesmente não envia esses logs (mas continua funcionando normalmente).

## Banco de dados (PostgreSQL no Railway)

Produtos e pedidos são persistidos em PostgreSQL.

1. No Railway, adicione o serviço **Postgres** ao projeto (se ainda não tiver).
2. No serviço do **bot**, adicione a variável `DATABASE_URL` referenciando a `DATABASE_URL` do serviço Postgres (Railway permite usar `${{Postgres.DATABASE_URL}}` como referência entre serviços, ou copiar o valor direto da aba Variables do Postgres). Use a URL **privada** (`*.railway.internal`), não a pública — é mais rápida e não conta como egress. Cole o valor **sem aspas**.
3. Para rodar localmente (fora do Railway), use a `DATABASE_PUBLIC_URL` do Postgres (proxy `*.proxy.rlwy.net`) na variável `DATABASE_PUBLIC_URL` do seu `.env`.
4. Não é preciso criar tabelas manualmente: ao iniciar, o bot roda uma migração automática (`CREATE TABLE IF NOT EXISTS ...`) e, se a tabela `products` estiver vazia, insere 3 produtos de exemplo (VIP Bronze, VIP Prata, VIP Ouro). Se você já tinha produtos de uma versão anterior (com ID em texto), a migração converte automaticamente para ID numérico + posição na primeira execução, sem perder os dados.

## Loja separada por servidor (multi-servidor — fase 1)

Produtos, configurações da loja (`/lojaconfig`), permissões (`/permissoes`) e canais de log (`/logs`) agora são **isolados por servidor Discord** — cada servidor tem seu próprio catálogo e configuração, mesmo que o mesmo bot esteja em vários servidores ao mesmo tempo. Um administrador de um servidor não enxerga nem consegue alterar os produtos de outro.

Se você já tinha uma loja rodando antes dessa mudança, a migração automática usa a variável `DISCORD_GUILD_ID` (se estiver configurada) para vincular os dados antigos ao servidor certo, sem perder nada. **Isso é só a base para suporte a múltiplos servidores** — o processamento de pagamento (Mercado Pago) ainda usa uma única credencial global (`MERCADO_PAGO_ACCESS_TOKEN`), compartilhada por todos os servidores onde o bot estiver. Conectar uma conta Mercado Pago própria por servidor é a próxima etapa planejada, ainda não implementada.

## Posição/ordem dos produtos

Cada produto tem uma posição (1 = primeiro na loja). Ao adicionar um produto numa posição já ocupada, os demais avançam uma posição automaticamente para abrir espaço. Ao editar a posição de um produto existente, os produtos entre a posição antiga e a nova são reordenados sozinhos — sem posições duplicadas ou espaços vazios. Ao remover um produto, os que vinham depois recuam uma posição.

## Configuração local

1. Copie `.env.example` para `.env` e preencha as variáveis.
2. Instale dependências:

```bash
npm install
```

3. Os comandos slash são registrados automaticamente ao iniciar. Se quiser registrar manualmente, execute:

```bash
npm run register:commands
```

4. Rode o bot:

```bash
npm run dev
```

## Deploy no Railway

O arquivo `railway.json` já define build, start, healthcheck e política de restart para o Railway. Se você não conseguir criar arquivos pelo painel, basta manter este arquivo no repositório e cadastrar as variáveis pela aba **Variables**. Veja também `docs/RAILWAY.md`.

1. Crie um projeto no Railway conectado a este repositório.
2. Configure as variáveis de ambiente listadas em `.env.railway.example`.
3. Defina `PUBLIC_BASE_URL` com a URL pública do serviço Railway.
4. Configure no painel do Mercado Pago o webhook apontando para:

```text
https://seu-projeto.up.railway.app/webhooks/mercado-pago
```

5. Use o comando de build `npm run build` e start `npm start`.

## Segurança

- **Assinatura do webhook validada:** o endpoint `POST /webhooks/mercado-pago` valida o header `x-signature` (HMAC-SHA256) usando `MERCADO_PAGO_WEBHOOK_SECRET`, conforme a especificação oficial do Mercado Pago. Sem essa variável configurada, o bot aceita as notificações mas avisa no log que está rodando sem validação — configure a assinatura secreta em "Suas integrações → Webhooks" no painel do Mercado Pago assim que possível.
- **Aprovação sempre re-verificada na API:** mesmo com a assinatura validada, o bot nunca confia cegamente no corpo da notificação — ele sempre confere o status real do pagamento direto na API do Mercado Pago antes de liberar a entrega.
- **Limite de tamanho e rate limit no webhook:** requisições acima de 1 MB são rejeitadas, e o endpoint aceita no máximo 60 requisições por minuto por IP.
- **Mensagens de erro genéricas para o usuário:** detalhes internos de erro (Mercado Pago, banco de dados) não são mais expostos nas respostas do Discord — ficam apenas no log do Railway, visível só para quem administra o projeto.
- **Variáveis de ambiente protegidas contra erro de digitação:** aspas/espaços colados por engano em qualquer variável (`DISCORD_TOKEN`, `MERCADO_PAGO_ACCESS_TOKEN`, `DATABASE_URL`, etc.) são removidos automaticamente antes de usar.
- **Sem SQL injection:** todas as consultas usam parâmetros (`$1`, `$2`, ...), nunca concatenação de string.
- **Comandos administrativos restritos:** `/addproduto`, `/editarproduto` e `/removerproduto` exigem o cargo moderador ou admin (ou dono do servidor); `/lojaconfig` exige o cargo admin (ou dono do servidor); `/permissoes` — que decide quem tem esses cargos — só pode ser usado pelo dono do servidor, propositalmente, pra ninguém conseguir se auto-promover.
- **Pedidos isolados por usuário:** `/pedido` e `/pedidos` só mostram pedidos do próprio usuário que executou o comando.

## Expiração automática de pedidos

Pedidos que ficam **pendentes por mais de 1 hora sem pagamento** são cancelados automaticamente:

- A cada 5 minutos, o bot verifica e marca como `cancelled` todo pedido pendente criado há mais de 1 hora.
- O próprio PIX gerado no Mercado Pago já é criado com validade de 1 hora (`date_of_expiration`), então o QR Code também para de funcionar no app do banco nesse mesmo prazo.
- Se o usuário clicar em "Comprar" de novo para o mesmo produto enquanto ainda tem um PIX pendente válido, o bot reaproveita o pedido existente em vez de gerar um PIX duplicado.
- Caso o pagamento seja confirmado bem no limite do prazo (ou logo depois), o bot ainda assim libera a entrega normalmente — a expiração é só para não acumular pedidos "mortos" no banco.

## Verificação automática de pagamento (backup do webhook)

A entrega (cargo + DM) normalmente acontece assim que o Mercado Pago avisa o bot pelo webhook. Mas se essa notificação não chegar por algum motivo — `PUBLIC_BASE_URL` mal configurado, instabilidade de rede, etc — o comprador não deveria ficar esperando pra sempre. Por isso, a cada 2 minutos o bot também verifica diretamente na API do Mercado Pago todo pedido pendente que já tem um PIX gerado, e libera a entrega automaticamente assim que detectar aprovação — sem precisar de nenhum comando manual.

Isso significa que a entrega automática tem dois caminhos independentes:
1. **Webhook** (imediato, assim que o Mercado Pago notifica).
2. **Verificação periódica** (a cada 2 minutos, como rede de segurança).

Se o webhook estiver funcionando direito, a entrega é praticamente instantânea. Se não estiver, o pior caso é o comprador esperar até 2 minutos — bem melhor do que depender de alguém clicar em "Verificar pagamento" manualmente. Para checar se o webhook está configurado corretamente, veja a seção "Erros ao gerar PIX" abaixo.

## Personalizando produtos

Os produtos ficam no banco de dados, não mais no código. Use `/addproduto`, `/editarproduto` e `/removerproduto` no Discord (dono do servidor). Os 3 produtos de exemplo inseridos automaticamente na primeira execução podem ser editados ou removidos da mesma forma.


## Erros ao gerar PIX

Se `/comprar` responder com erro do Mercado Pago, confira `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_PAYER_EMAIL` e `PUBLIC_BASE_URL`. O e-mail do pagador precisa ser válido; para testes, use preferencialmente um e-mail diferente do e-mail da conta Mercado Pago que recebe o pagamento. Se aparecer `http is unavailable for request create_ti`, ajuste `PUBLIC_BASE_URL` para a URL pública HTTPS do Railway, começando com `https://`.

## Comandos slash não aparecem

- Confirme que o bot foi convidado com o escopo `applications.commands` além de `bot`.
- Para comandos aparecerem imediatamente, preencha `DISCORD_GUILD_ID` com o ID do seu servidor. Sem `DISCORD_GUILD_ID`, os comandos são globais e podem demorar para aparecer no Discord.
- Deixe `AUTO_REGISTER_COMMANDS=true` no Railway, ou execute `npm run register:commands` após configurar as variáveis.
