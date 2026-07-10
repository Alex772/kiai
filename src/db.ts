import { Pool } from 'pg';

function cleanEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.replace(/^['"]|['"]$/g, '').trim();
}

const connectionString = cleanEnv(process.env.DATABASE_URL) || cleanEnv(process.env.DATABASE_PUBLIC_URL);

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
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        product_description TEXT NOT NULL,
        product_price NUMERIC(10,2) NOT NULL,
        product_delivery_message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payment_id TEXT,
        qr_code TEXT,
        qr_code_base64 TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders (user_id);');
    await client.query('CREATE INDEX IF NOT EXISTS orders_payment_id_idx ON orders (payment_id);');

    const { rows: columnRows } = await client.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'products'`
    );

    const productsExists = columnRows.length > 0;
    const idColumn = columnRows.find((c) => c.column_name === 'id');
    const idIsInteger = idColumn ? ['integer', 'bigint', 'smallint'].includes(idColumn.data_type) : false;
    const hasPosition = columnRows.some((c) => c.column_name === 'position');

    if (!productsExists) {
      await client.query(`
        CREATE TABLE products (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          price NUMERIC(10,2) NOT NULL,
          delivery_message TEXT NOT NULL,
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
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          price NUMERIC(10,2) NOT NULL,
          delivery_message TEXT NOT NULL,
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

    await client.query('CREATE INDEX IF NOT EXISTS products_position_idx ON products (position);');

    await client.query(`
      CREATE TABLE IF NOT EXISTS store_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const [{ count }] = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM products');

  if (count === 0) {
    let position = 1;
    for (const product of DEFAULT_PRODUCTS) {
      await pool.query(
        'INSERT INTO products (name, description, price, delivery_message, position) VALUES ($1,$2,$3,$4,$5)',
        [product.name, product.description, product.price, product.deliveryMessage, position++]
      );
    }
    console.log('Produtos padrão inseridos no banco de dados (VIP Bronze, VIP Prata, VIP Ouro).');
  }
}
