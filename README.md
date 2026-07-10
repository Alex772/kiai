# Kiai Discord Shop Bot

Bot Discord para gerenciar uma loja com pagamentos em dinheiro real via PIX usando Mercado Pago, preparado para hospedagem no Railway.

## Funcionalidades

- `/loja`: mostra os produtos com paginação (botões Anterior/Próxima e um botão "Página X/Y" que abre um campo pra digitar a página desejada) e botão "Comprar" em cada um.
- `/comprar`: cria um pedido e gera PIX (código copia-e-cola + imagem do QR Code) pelo Mercado Pago.
- `/pedido`: consulta o status detalhado de um pedido (valor, ID do pagamento no Mercado Pago, datas).
- `/pedidos`: lista os últimos pedidos do usuário.
- `/addproduto`: adiciona um produto (ID é gerado automaticamente pelo banco; opcionalmente você escolhe a posição na lista).
- `/editarproduto`: mostra a lista de produtos num menu — ao escolher um, abre um formulário (modal) já preenchido com nome, preço, descrição, mensagem de entrega e posição atuais, prontos pra editar.
- `/removerproduto`: remove um produto da loja (os produtos seguintes reordenam automaticamente pra fechar o espaço).
- `/lojaconfig`: configura título, descrição e quantidade de itens por página da loja. Sem argumentos, mostra a configuração atual.
- Webhook `POST /webhooks/mercado-pago`: recebe notificações do Mercado Pago e envia DM quando o pagamento for aprovado.
- Healthcheck `GET /health` para Railway.
- Registro automático dos comandos slash ao iniciar (`AUTO_REGISTER_COMMANDS=true` por padrão).
- Tratamento de erro nas interações para o Discord não ficar preso em "pensando..." se o Mercado Pago recusar a requisição.

> Se as variáveis obrigatórias ainda não estiverem configuradas, o processo não derruba o Railway: ele sobe apenas o servidor HTTP, mostra as variáveis faltantes em `/health` e só conecta o bot ao Discord quando `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` e `MERCADO_PAGO_ACCESS_TOKEN` existirem.

## Banco de dados (PostgreSQL no Railway)

Produtos e pedidos são persistidos em PostgreSQL.

1. No Railway, adicione o serviço **Postgres** ao projeto (se ainda não tiver).
2. No serviço do **bot**, adicione a variável `DATABASE_URL` referenciando a `DATABASE_URL` do serviço Postgres (Railway permite usar `${{Postgres.DATABASE_URL}}` como referência entre serviços, ou copiar o valor direto da aba Variables do Postgres). Use a URL **privada** (`*.railway.internal`), não a pública — é mais rápida e não conta como egress. Cole o valor **sem aspas**.
3. Para rodar localmente (fora do Railway), use a `DATABASE_PUBLIC_URL` do Postgres (proxy `*.proxy.rlwy.net`) na variável `DATABASE_PUBLIC_URL` do seu `.env`.
4. Não é preciso criar tabelas manualmente: ao iniciar, o bot roda uma migração automática (`CREATE TABLE IF NOT EXISTS ...`) e, se a tabela `products` estiver vazia, insere 3 produtos de exemplo (VIP Bronze, VIP Prata, VIP Ouro). Se você já tinha produtos de uma versão anterior (com ID em texto), a migração converte automaticamente para ID numérico + posição na primeira execução, sem perder os dados.

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

## Personalizando produtos

Os produtos ficam no banco de dados, não mais no código. Use `/addproduto`, `/editarproduto` e `/removerproduto` no Discord (dono do servidor). Os 3 produtos de exemplo inseridos automaticamente na primeira execução podem ser editados ou removidos da mesma forma.


## Erros ao gerar PIX

Se `/comprar` responder com erro do Mercado Pago, confira `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_PAYER_EMAIL` e `PUBLIC_BASE_URL`. O e-mail do pagador precisa ser válido; para testes, use preferencialmente um e-mail diferente do e-mail da conta Mercado Pago que recebe o pagamento. Se aparecer `http is unavailable for request create_ti`, ajuste `PUBLIC_BASE_URL` para a URL pública HTTPS do Railway, começando com `https://`.

## Comandos slash não aparecem

- Confirme que o bot foi convidado com o escopo `applications.commands` além de `bot`.
- Para comandos aparecerem imediatamente, preencha `DISCORD_GUILD_ID` com o ID do seu servidor. Sem `DISCORD_GUILD_ID`, os comandos são globais e podem demorar para aparecer no Discord.
- Deixe `AUTO_REGISTER_COMMANDS=true` no Railway, ou execute `npm run register:commands` após configurar as variáveis.
