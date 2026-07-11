import { query } from './db.js';

export type StoreSettings = {
  itemsPerPage: number;
  title: string;
  description: string;
  /** Cargo com acesso total: configura a loja (/lojaconfig) e gerencia produtos. */
  adminRoleId?: string;
  /** Cargo com acesso limitado: só gerencia produtos (adicionar/editar/remover). */
  moderatorRoleId?: string;
};

export type StoreSettingsPatch = Partial<{
  itemsPerPage: number;
  title: string;
  description: string;
  /** Passe null para remover o cargo configurado. */
  adminRoleId: string | null;
  moderatorRoleId: string | null;
}>;

const DEFAULTS: StoreSettings = {
  itemsPerPage: 5,
  title: '🛒 Loja',
  description: 'Escolha um produto abaixo para comprar via PIX (Mercado Pago).'
};

export async function getStoreSettings(): Promise<StoreSettings> {
  const rows = await query<{ key: string; value: string }>('SELECT key, value FROM store_settings');
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const itemsPerPage = map.items_per_page ? Number(map.items_per_page) : DEFAULTS.itemsPerPage;

  return {
    itemsPerPage: Number.isFinite(itemsPerPage) && itemsPerPage > 0 ? itemsPerPage : DEFAULTS.itemsPerPage,
    title: map.title ?? DEFAULTS.title,
    description: map.description ?? DEFAULTS.description,
    adminRoleId: map.admin_role_id ?? undefined,
    moderatorRoleId: map.moderator_role_id ?? undefined
  };
}

export async function updateStoreSettings(patch: StoreSettingsPatch): Promise<StoreSettings> {
  const upserts: [string, string][] = [];
  const deletes: string[] = [];

  if (patch.itemsPerPage !== undefined) upserts.push(['items_per_page', String(patch.itemsPerPage)]);
  if (patch.title !== undefined) upserts.push(['title', patch.title]);
  if (patch.description !== undefined) upserts.push(['description', patch.description]);

  if (patch.adminRoleId !== undefined) {
    if (patch.adminRoleId === null) deletes.push('admin_role_id');
    else upserts.push(['admin_role_id', patch.adminRoleId]);
  }

  if (patch.moderatorRoleId !== undefined) {
    if (patch.moderatorRoleId === null) deletes.push('moderator_role_id');
    else upserts.push(['moderator_role_id', patch.moderatorRoleId]);
  }

  for (const [key, value] of upserts) {
    await query(
      'INSERT INTO store_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, value]
    );
  }

  for (const key of deletes) {
    await query('DELETE FROM store_settings WHERE key = $1', [key]);
  }

  return getStoreSettings();
}
