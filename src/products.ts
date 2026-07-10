import { query } from './db.js';

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  deliveryMessage: string;
};

export type ProductUpdate = Partial<Pick<Product, 'name' | 'description' | 'price' | 'deliveryMessage'>>;

type ProductRow = {
  id: string;
  name: string;
  description: string;
  price: string;
  delivery_message: string;
};

function mapRow(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    deliveryMessage: row.delivery_message
  };
}

export async function listProducts(): Promise<Product[]> {
  const rows = await query<ProductRow>('SELECT * FROM products ORDER BY created_at ASC');
  return rows.map(mapRow);
}

export async function findProduct(productId: string): Promise<Product | undefined> {
  const rows = await query<ProductRow>('SELECT * FROM products WHERE id = $1', [productId]);
  return rows[0] ? mapRow(rows[0]) : undefined;
}

export async function addProduct(product: Product): Promise<void> {
  await query(
    'INSERT INTO products (id, name, description, price, delivery_message) VALUES ($1,$2,$3,$4,$5)',
    [product.id, product.name, product.description, product.price, product.deliveryMessage]
  );
}

export async function removeProduct(productId: string): Promise<boolean> {
  const rows = await query('DELETE FROM products WHERE id = $1 RETURNING id', [productId]);
  return rows.length > 0;
}

export async function editProduct(productId: string, patch: ProductUpdate): Promise<Product | undefined> {
  const current = await findProduct(productId);
  if (!current) return undefined;

  const updated: Product = { ...current, ...patch };

  await query(
    'UPDATE products SET name=$2, description=$3, price=$4, delivery_message=$5, updated_at=now() WHERE id=$1',
    [productId, updated.name, updated.description, updated.price, updated.deliveryMessage]
  );

  return updated;
}
