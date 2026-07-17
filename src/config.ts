import 'dotenv/config';

export const requiredEnvKeys = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'MERCADO_PAGO_ACCESS_TOKEN'] as const;

// Remove aspas e espaços acidentais colados nas variáveis (ex: cadastrar "APP_USR-..." em vez de APP_USR-...
// diretamente no painel do Railway). Isso corrompe silenciosamente tokens e é uma causa comum de erros de
// autenticação como "authorization value not present".
function cleanEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  const unquoted = trimmed.replace(/^['"]|['"]$/g, '').trim();
  return unquoted;
}

function readEnv(key: string): string | undefined {
  return cleanEnv(process.env[key]);
}

export function getMissingRequiredEnv() {
  return requiredEnvKeys.filter((key) => !readEnv(key));
}

export function assertRequiredEnv() {
  const missing = getMissingRequiredEnv();

  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}`);
  }
}

export const config = {
  discordToken: readEnv('DISCORD_TOKEN') ?? '',
  discordClientId: readEnv('DISCORD_CLIENT_ID') ?? '',
  discordGuildId: readEnv('DISCORD_GUILD_ID'),
  botOwnerId: readEnv('BOT_OWNER_ID'),
  mercadoPagoAccessToken: readEnv('MERCADO_PAGO_ACCESS_TOKEN') ?? '',
  mercadoPagoWebhookSecret: readEnv('MERCADO_PAGO_WEBHOOK_SECRET'),
  mercadoPagoPayerEmail: readEnv('MERCADO_PAGO_PAYER_EMAIL'),
  mercadoPagoClientId: readEnv('MERCADO_PAGO_CLIENT_ID'),
  mercadoPagoClientSecret: readEnv('MERCADO_PAGO_CLIENT_SECRET'),
  publicBaseUrl: readEnv('PUBLIC_BASE_URL'),
  currency: readEnv('STORE_CURRENCY') ?? 'BRL',
  adminRoleId: readEnv('ADMIN_ROLE_ID'),
  autoRegisterCommands: readEnv('AUTO_REGISTER_COMMANDS') !== 'false'
};
