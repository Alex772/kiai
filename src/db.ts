import { Pool } from 'pg';

function cleanEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.replace(/^['"]|['"]$/g, '').trim();
}

const connectionString = cleanEnv(process.env.DATABASE_URL) || cleanEnv(process.env.DATABASE_PUBLIC_URL);
const fallbackGuildId = cleanEnv(process.env.DISCORD_GUILD_ID);

if (!connectionString) {
  console.warn(
    'Nenhuma variável DATABASE_URL/DATABASE_PUBLIC_URL definida. Configure o banco Postgres do Railway para habilitar produtos e pedidos.'
  );
}

// A URL privada (DATABASE_URL, *.railway.internal) não precisa de SSL.
// A URL pública (proxy.rlwy.net) do Railway aceita conexão com SSL "solto" (certificado não validado pela CA pública).
const isPublicProxy = /\.proxy\.rlwy\.net|railway\.app/.test(connectionString ?? '');

export const pool = new Pool({
  connectionString,
  ssl: isPublicProxy ? { rejectUnauthorized: false } : undefined,
  max: 5,
  idleTimeoutMillis: 30_000
});

pool.on('error', (err) => {
  console.error('Erro inesperado no pool do PostgreSQL:', err);
});

export async function query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export function isDatabaseConfigured() {
  return Boolean(connectionString);
}

const DEFAULT_PRODUCTS = [
  {
    name: 'VIP Bronze',
    description: 'Acesso VIP inicial por 30 dias.',
    price: 9.9,
    deliveryMessage: 'Obrigado pela compra do VIP Bronze! Abra um ticket caso precise ativar benefícios manuais.'
  },
  {
    name: 'VIP Prata',
    description: 'Acesso VIP intermediário por 30 dias.',
    price: 19.9,
    deliveryMessage: 'Obrigado pela compra do VIP Prata! Abra um ticket caso precise ativar benefícios manuais.'
  },
  {
    name: 'VIP Ouro',
    description: 'Acesso VIP premium por 30 dias.',
    price: 29.9,
    deliveryMessage: 'Obrigado pela compra do VIP Ouro! Abra um ticket caso precise ativar benefícios manuais.'
  }
];

export async function migrate() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY,
        user_id TEXT NOT NULL,
        guild_id TEXT,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        product_description TEXT NOT NULL,
        product_price NUMERIC(10,2) NOT NULL,
        product_delivery_message TEXT NOT NULL,
        product_delivery_role_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        payment_method TEXT NOT NULL DEFAULT 'pix',
        payment_id TEXT,
        qr_code TEXT,
        qr_code_base64 TEXT,
        checkout_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS guild_id TEXT;');
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_delivery_role_id TEXT;');
    await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'pix';");
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_url TEXT;');
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_delivery_role_duration_amount INTEGER;');
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_delivery_role_duration_unit TEXT;');
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS role_expires_at TIMESTAMPTZ;');
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS role_removed_at TIMESTAMPTZ;');
    await client.query('CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders (user_id);');
    await client.query('CREATE INDEX IF NOT EXISTS orders_payment_id_idx ON orders (payment_id);');
    await client.query('CREATE INDEX IF NOT EXISTS orders_role_expires_at_idx ON orders (role_expires_at);');
    await client.query('CREATE INDEX IF NOT EXISTS orders_guild_id_idx ON orders (guild_id);');

    // ---------- products ----------
    const { rows: columnRows } = await client.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'products'`
    );

    const productsExists = columnRows.length > 0;
    const idColumn = columnRows.find((c) => c.column_name === 'id');
    const idIsInteger = idColumn ? ['integer', 'bigint', 'smallint'].includes(idColumn.data_type) : false;
    const hasPosition = columnRows.some((c) => c.column_name === 'position');
    const hasGuildId = columnRows.some((c) => c.column_name === 'guild_id');

    if (!productsExists) {
      await client.query(`
        CREATE TABLE products (
          id SERIAL PRIMARY KEY,
          guild_id TEXT,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          price NUMERIC(10,2) NOT NULL,
          delivery_message TEXT NOT NULL,
          delivery_role_id TEXT,
          position INTEGER NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
    } else if (!idIsInteger) {
      // Esquema antigo (id em texto, escolhido manualmente): migra para ID numérico automático + posição,
      // preservando os dados existentes e a ordem de criação.
      await client.query('ALTER TABLE products RENAME TO products_legacy');
      await client.query(`
        CREATE TABLE products (
          id SERIAL PRIMARY KEY,
          guild_id TEXT,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          price NUMERIC(10,2) NOT NULL,
          delivery_message TEXT NOT NULL,
          delivery_role_id TEXT,
          position INTEGER NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await client.query(`
        INSERT INTO products (name, description, price, delivery_message, position, created_at, updated_at)
        SELECT name, description, price, delivery_message,
               ROW_NUMBER() OVER (ORDER BY created_at)::int,
               created_at, updated_at
        FROM products_legacy
        ORDER BY created_at;
      `);
      await client.query('DROP TABLE products_legacy');
      console.log('Migração: tabela products convertida para ID numérico automático (antigo ID vira apenas texto histórico nos pedidos).');
    } else if (!hasPosition) {
      await client.query('ALTER TABLE products ADD COLUMN position INTEGER');
      await client.query(`
        UPDATE products SET position = sub.rownum
        FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rownum FROM products) AS sub
        WHERE products.id = sub.id;
      `);
      await client.query('ALTER TABLE products ALTER COLUMN position SET NOT NULL');
      console.log('Migração: coluna position adicionada em products.');
    }

    await client.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_role_id TEXT;');
    await client.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_role_duration_amount INTEGER;');
    await client.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_role_duration_unit TEXT;');

    if (!hasGuildId) {
      await client.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS guild_id TEXT;');

      if (fallbackGuildId) {
        const { rowCount } = await client.query('UPDATE products SET guild_id = $1 WHERE guild_id IS NULL', [fallbackGuildId]);
        if (rowCount && rowCount > 0) {
          console.log(
            `Migração: ${rowCount} produto(s) existente(s) vinculados ao servidor ${fallbackGuildId} (via DISCORD_GUILD_ID). A loja agora é separada por servidor.`
          );
        }
      } else {
        console.warn(
          'Migração: coluna guild_id adicionada em products, mas DISCORD_GUILD_ID não está definida — produtos antigos ficaram sem servidor associado e não vão aparecer em nenhuma loja até serem associados manualmente (ou até você definir DISCORD_GUILD_ID e reiniciar).'
        );
      }
    }

    await client.query('DROP INDEX IF EXISTS products_position_idx;');
    await client.query('CREATE INDEX IF NOT EXISTS products_guild_position_idx ON products (guild_id, position);');

    // ---------- store_settings ----------
    const { rows: settingsColumnRows } = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'store_settings'`
    );
    const settingsExists = settingsColumnRows.length > 0;
    const settingsHasGuildId = settingsColumnRows.some((c) => c.column_name === 'guild_id');

    if (!settingsExists) {
      await client.query(`
        CREATE TABLE store_settings (
          guild_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (guild_id, key)
        );
      `);
    } else if (!settingsHasGuildId) {
      // Esquema antigo (configuração única, sem separação por servidor): migra para chave composta
      // (guild_id, key), associando a configuração existente ao servidor de DISCORD_GUILD_ID.
      await client.query('ALTER TABLE store_settings RENAME TO store_settings_legacy');
      await client.query(`
        CREATE TABLE store_settings (
          guild_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (guild_id, key)
        );
      `);

      if (fallbackGuildId) {
        await client.query(
          `INSERT INTO store_settings (guild_id, key, value) SELECT $1, key, value FROM store_settings_legacy`,
          [fallbackGuildId]
        );
        console.log(`Migração: configurações da loja vinculadas ao servidor ${fallbackGuildId} (via DISCORD_GUILD_ID).`);
        await client.query('DROP TABLE store_settings_legacy');
      } else {
        // Não apaga os dados antigos: sem DISCORD_GUILD_ID não sabemos a qual servidor associá-los.
        // Ficam guardados em store_settings_legacy para recuperação manual, se necessário.
        console.warn(
          'Migração: configurações antigas da loja (itens por página, permissões, canais de log) NÃO foram migradas porque DISCORD_GUILD_ID não está definida. Os dados antigos foram preservados na tabela store_settings_legacy (não apagados). Configure DISCORD_GUILD_ID e reinicie, ou reconfigure manualmente com /lojaconfig, /permissoes e /logs.'
        );
      }
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS guild_mp_connections (
        guild_id TEXT PRIMARY KEY,
        access_token_encrypted TEXT NOT NULL,
        refresh_token_encrypted TEXT NOT NULL,
        mp_user_id TEXT,
        public_key TEXT,
        connected_by TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS guild_mp_connections_mp_user_id_idx ON guild_mp_connections (mp_user_id);');

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (fallbackGuildId) {
    const [{ count }] = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM products WHERE guild_id = $1', [
      fallbackGuildId
    ]);

    if (count === 0) {
      let position = 1;
      for (const product of DEFAULT_PRODUCTS) {
        await pool.query(
          'INSERT INTO products (guild_id, name, description, price, delivery_message, position) VALUES ($1,$2,$3,$4,$5,$6)',
          [fallbackGuildId, product.name, product.description, product.price, product.deliveryMessage, position++]
        );
      }
      console.log(`Produtos padrão inseridos para o servidor ${fallbackGuildId} (VIP Bronze, VIP Prata, VIP Ouro).`);
    }
  }
}
