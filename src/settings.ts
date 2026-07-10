import { query } from './db.js';

export type StoreSettings = {
  itemsPerPage: number;
  title: string;
  description: string;
};

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
    description: map.description ?? DEFAULTS.description
  };
}

export async function updateStoreSettings(patch: Partial<StoreSettings>): Promise<StoreSettings> {
  const entries: [string, string][] = [];

  if (patch.itemsPerPage !== undefined) entries.push(['items_per_page', String(patch.itemsPerPage)]);
  if (patch.title !== undefined) entries.push(['title', patch.title]);
  if (patch.description !== undefined) entries.push(['description', patch.description]);

  for (const [key, value] of entries) {
    await query(
      'INSERT INTO store_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, value]
    );
  }

  return getStoreSettings();
}
