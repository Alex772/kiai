import { query } from './db.js';

/**
 * Configurações globais do bot (não por servidor) — hoje só a taxa de comissão que o dono do bot
 * recebe em cada venda de servidores conectados via OAuth (split de pagamento).
 */

const COMMISSION_KEY = 'commission_percent';

export async function getCommissionPercent(): Promise<number> {
  const rows = await query<{ value: string }>('SELECT value FROM platform_settings WHERE key = $1', [COMMISSION_KEY]);
  const value = rows[0] ? Number(rows[0].value) : 0;
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export async function setCommissionPercent(percent: number): Promise<void> {
  await query(
    'INSERT INTO platform_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [COMMISSION_KEY, String(percent)]
  );
}
