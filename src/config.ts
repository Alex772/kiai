import 'dotenv/config';

const requiredKeys = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'MERCADO_PAGO_ACCESS_TOKEN'] as const;

for (const key of requiredKeys) {
  if (!process.env[key]) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${key}`);
  }
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN!,
  discordClientId: process.env.DISCORD_CLIENT_ID!,
  discordGuildId: process.env.DISCORD_GUILD_ID,
  mercadoPagoAccessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN!,
  mercadoPagoWebhookSecret: process.env.MERCADO_PAGO_WEBHOOK_SECRET,
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  currency: process.env.STORE_CURRENCY ?? 'BRL',
  adminRoleId: process.env.ADMIN_ROLE_ID
};
