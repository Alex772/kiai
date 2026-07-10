import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;

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
    id: 'vip_bronze',
    name: 'VIP Bronze',
    description: 'Acesso VIP inicial por 30 dias.',
    price: 9.9,
    deliveryMessage: 'Obrigado pela compra do VIP Bronze! Abra um ticket caso precise ativar benefícios manuais.'
  },
  {
    id: 'vip_prata',
    name: 'VIP Prata',
    description: 'Acesso VIP intermediário por 30 dias.',
    price: 19.9,
    deliveryMessage: 'Obrigado pela compra do VIP Prata! Abra um ticket caso precise ativar benefícios manuais.'
  },
  {
    id: 'vip_ouro',
    name: 'VIP Ouro',
    description: 'Acesso VIP premium por 30 dias.',
    price: 29.9,
    deliveryMessage: 'Obrigado pela compra do VIP Ouro! Abra um ticket caso precise ativar benefícios manuais.'
  }
];

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      delivery_message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
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

  await pool.query('CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders (user_id);');
  await pool.query('CREATE INDEX IF NOT EXISTS orders_payment_id_idx ON orders (payment_id);');

  const [{ count }] = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM products');

  if (count === 0) {
    for (const product of DEFAULT_PRODUCTS) {
      await pool.query(
        'INSERT INTO products (id, name, description, price, delivery_message) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING',
        [product.id, product.name, product.description, product.price, product.deliveryMessage]
      );
    }
    console.log('Produtos padrão inseridos no banco de dados (vip_bronze, vip_prata, vip_ouro).');
  }
}
