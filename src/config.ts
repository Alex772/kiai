import 'dotenv/config';

export const requiredEnvKeys = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'MERCADO_PAGO_ACCESS_TOKEN'] as const;

export function getMissingRequiredEnv() {
  return requiredEnvKeys.filter((key) => !process.env[key]);
}

export function assertRequiredEnv() {
  const missing = getMissingRequiredEnv();

  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}`);
  }
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN ?? '',
  discordClientId: process.env.DISCORD_CLIENT_ID ?? '',
  discordGuildId: process.env.DISCORD_GUILD_ID,
  mercadoPagoAccessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN ?? '',
  mercadoPagoWebhookSecret: process.env.MERCADO_PAGO_WEBHOOK_SECRET,
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  currency: process.env.STORE_CURRENCY ?? 'BRL',
  adminRoleId: process.env.ADMIN_ROLE_ID,
  autoRegisterCommands: process.env.AUTO_REGISTER_COMMANDS !== 'false'
};
