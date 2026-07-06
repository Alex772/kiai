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
| `PUBLIC_BASE_URL` | URL pública do serviço no Railway | Recomendado para webhooks |
| `DISCORD_GUILD_ID` | ID do servidor Discord | Opcional, mas recomendado para testar comandos rapidamente |
| `STORE_CURRENCY` | Use `BRL` | Opcional |
| `ADMIN_ROLE_ID` | ID do cargo admin no Discord | Opcional |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Configuração futura de assinatura de webhook | Opcional |

Enquanto as variáveis obrigatórias não forem cadastradas, o serviço continuará de pé em modo incompleto e `/health` mostrará quais nomes estão faltando.

## Webhook Mercado Pago

Depois que o deploy estiver ativo, configure no Mercado Pago o webhook:

```text
https://seu-projeto.up.railway.app/webhooks/mercado-pago
```

Substitua `seu-projeto.up.railway.app` pela URL pública real do seu serviço Railway.
