# Kiai Discord Shop Bot

Bot Discord para gerenciar uma loja com pagamentos em dinheiro real via PIX usando Mercado Pago, preparado para hospedagem no Railway.

## Funcionalidades

- `/loja`: lista produtos configurados.
- `/comprar`: cria um pedido e gera PIX copia-e-cola pelo Mercado Pago.
- `/pedido`: consulta o status de um pedido em memória.
- Webhook `POST /webhooks/mercado-pago`: recebe notificações do Mercado Pago e envia DM quando o pagamento for aprovado.
- Healthcheck `GET /health` para Railway.

> Atenção: esta versão inicial mantém pedidos em memória. Para produção, adicione PostgreSQL/Redis no Railway para não perder pedidos ao reiniciar o deploy.
>
> Se as variáveis obrigatórias ainda não estiverem configuradas, o processo não derruba o Railway: ele sobe apenas o servidor HTTP, mostra as variáveis faltantes em `/health` e só conecta o bot ao Discord quando `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` e `MERCADO_PAGO_ACCESS_TOKEN` existirem.

## Configuração local

1. Copie `.env.example` para `.env` e preencha as variáveis.
2. Instale dependências:

```bash
npm install
```

3. Registre os comandos no Discord:

```bash
npm run register:commands
```

4. Rode o bot:

```bash
npm run dev
```

## Deploy no Railway

1. Crie um projeto no Railway conectado a este repositório.
2. Configure as variáveis de ambiente listadas em `.env.example`.
3. Defina `PUBLIC_BASE_URL` com a URL pública do serviço Railway.
4. Configure no painel do Mercado Pago o webhook apontando para:

```text
https://seu-projeto.up.railway.app/webhooks/mercado-pago
```

5. Use o comando de build `npm run build` e start `npm start`.

## Personalizando produtos

Edite `src/products.ts` para alterar IDs, nomes, descrições, preços e mensagens de entrega.
