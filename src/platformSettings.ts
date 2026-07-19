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

/**
 * Faixas de comissão por valor de venda — ex: vendas até R$1 pagam 50%, até R$5 pagam 20%, etc.
 * A taxa "padrão" definida por /comissao continua valendo pra qualquer valor que não caia em
 * nenhuma faixa (normalmente, valores acima da maior faixa cadastrada).
 */

export type CommissionTier = {
  id: number;
  maxAmount: number;
  percent: number;
};

type CommissionTierRow = {
  id: number;
  max_amount: string;
  percent: string;
};

function mapTierRow(row: CommissionTierRow): CommissionTier {
  return { id: row.id, maxAmount: Number(row.max_amount), percent: Number(row.percent) };
}

export async function listCommissionTiers(): Promise<CommissionTier[]> {
  const rows = await query<CommissionTierRow>('SELECT * FROM commission_tiers ORDER BY max_amount ASC');
  return rows.map(mapTierRow);
}

export async function findCommissionTier(id: number): Promise<CommissionTier | undefined> {
  const rows = await query<CommissionTierRow>('SELECT * FROM commission_tiers WHERE id = $1', [id]);
  return rows[0] ? mapTierRow(rows[0]) : undefined;
}

export async function createCommissionTier(maxAmount: number, percent: number): Promise<CommissionTier> {
  const rows = await query<CommissionTierRow>(
    'INSERT INTO commission_tiers (max_amount, percent) VALUES ($1,$2) RETURNING *',
    [maxAmount, percent]
  );
  return mapTierRow(rows[0]);
}

export async function updateCommissionTier(
  id: number,
  patch: { maxAmount?: number; percent?: number }
): Promise<CommissionTier | undefined> {
  const current = await findCommissionTier(id);
  if (!current) return undefined;

  const rows = await query<CommissionTierRow>(
    'UPDATE commission_tiers SET max_amount=$2, percent=$3, updated_at=now() WHERE id=$1 RETURNING *',
    [id, patch.maxAmount ?? current.maxAmount, patch.percent ?? current.percent]
  );
  return mapTierRow(rows[0]);
}

export async function deleteCommissionTier(id: number): Promise<boolean> {
  const rows = await query('DELETE FROM commission_tiers WHERE id = $1 RETURNING id', [id]);
  return rows.length > 0;
}

/**
 * Resolve o percentual de comissão pra um valor de venda: usa a menor faixa cadastrada cujo
 * "até R$X" seja maior ou igual ao preço; se nenhuma faixa cobrir esse valor, cai pra taxa padrão
 * global (/comissao).
 */
export async function resolveCommissionPercent(price: number): Promise<number> {
  const tiers = await listCommissionTiers();
  const match = tiers.find((tier) => price <= tier.maxAmount);
  if (match) return match.percent;
  return getCommissionPercent();
}
