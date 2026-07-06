# Configuração no Railway

Este repositório já inclui `railway.json`, então você não precisa criar comandos manualmente no painel do Railway.

## Build e Start

O Railway usará automaticamente:

- Build: `npm run build`
- Start: `npm run start`
- Healthcheck: `/health`

## Variáveis obrigatórias

Cadastre estas variáveis na aba **Variables** do serviço Railway:

| Variável | Onde encontrar | Obrigatória |
| --- | --- | --- |
| `DISCORD_TOKEN` | Discord Developer Portal > Bot > Token | Sim |
| `DISCORD_CLIENT_ID` | Discord Developer Portal > General Information > Application ID | Sim |
| `MERCADO_PAGO_ACCESS_TOKEN` | Mercado Pago Developers > Credenciais de produção | Sim |
| `MERCADO_PAGO_PAYER_EMAIL` | E-mail padrão válido para gerar PIX quando o Discord não informa e-mail | Recomendado |
| `PUBLIC_BASE_URL` | URL pública do serviço no Railway | Recomendado para webhooks |
| `DISCORD_GUILD_ID` | ID do servidor Discord | Opcional, mas recomendado para testar comandos rapidamente |
| `STORE_CURRENCY` | Use `BRL` | Opcional |
| `ADMIN_ROLE_ID` | ID do cargo admin no Discord | Opcional |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Configuração futura de assinatura de webhook | Opcional |
| `AUTO_REGISTER_COMMANDS` | Use `true` para registrar slash commands ao iniciar | Opcional, padrão `true` |

Enquanto as variáveis obrigatórias não forem cadastradas, o serviço continuará de pé em modo incompleto e `/health` mostrará quais nomes estão faltando.

### Observação sobre `MERCADO_PAGO_PAYER_EMAIL`

Use um e-mail válido para representar o comprador quando o Discord não fornecer e-mail. Para testes, prefira um e-mail diferente do e-mail dono da conta Mercado Pago que recebe o dinheiro; se o Mercado Pago recusar, a resposta do bot agora mostra o detalhe retornado pela API.

## Webhook Mercado Pago

Depois que o deploy estiver ativo, configure no Mercado Pago o webhook:

```text
https://seu-projeto.up.railway.app/webhooks/mercado-pago
```

Substitua `seu-projeto.up.railway.app` pela URL pública real do seu serviço Railway.

## Slash commands no Discord

O bot registra os comandos automaticamente quando inicia, desde que `AUTO_REGISTER_COMMANDS` não esteja como `false`. Para aparecer rápido, configure `DISCORD_GUILD_ID` com o ID do seu servidor. Comandos globais, sem `DISCORD_GUILD_ID`, podem levar mais tempo para aparecer no cliente Discord.

Ao convidar o bot, marque os escopos `bot` e `applications.commands`; sem `applications.commands`, os comandos slash não aparecem mesmo com o bot online.
