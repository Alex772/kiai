import { pool, query } from './db.js';

export type Product = {
  id: number;
  name: string;
  description: string;
  price: number;
  deliveryMessage: string;
  position?: number;
};

export type ProductInput = {
  name: string;
  description: string;
  price: number;
  deliveryMessage: string;
  /** Posição desejada na lista (1 = primeiro). Se omitido, entra no final. */
  position?: number;
};

export type ProductUpdate = Partial<{
  name: string;
  description: string;
  price: number;
  deliveryMessage: string;
  /** Nova posição na lista (1 = primeiro). Os demais produtos são reordenados automaticamente. */
  position: number;
}>;

type ProductRow = {
  id: number;
  name: string;
  description: string;
  price: string;
  delivery_message: string;
  position: number;
};

function mapRow(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    deliveryMessage: row.delivery_message,
    position: row.position
  };
}

export async function listProducts(): Promise<Product[]> {
  const rows = await query<ProductRow>('SELECT * FROM products ORDER BY position ASC, id ASC');
  return rows.map(mapRow);
}

export async function findProduct(productId: number): Promise<Product | undefined> {
  const rows = await query<ProductRow>('SELECT * FROM products WHERE id = $1', [productId]);
  return rows[0] ? mapRow(rows[0]) : undefined;
}

export async function countProducts(): Promise<number> {
  const rows = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM products');
  return rows[0]?.count ?? 0;
}

export async function addProduct(input: ProductInput): Promise<Product> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: countRows } = await client.query('SELECT COUNT(*)::int AS count FROM products');
    const total = countRows[0].count as number;
    const targetPosition = input.position && input.position >= 1 ? Math.min(input.position, total + 1) : total + 1;

    // Abre espaço na posição desejada, empurrando os produtos seguintes uma posição pra frente.
    await client.query('UPDATE products SET position = position + 1 WHERE position >= $1', [targetPosition]);

    const { rows } = await client.query<ProductRow>(
      `INSERT INTO products (name, description, price, delivery_message, position)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.name, input.description, input.price, input.deliveryMessage, targetPosition]
    );

    await client.query('COMMIT');
    return mapRow(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function removeProduct(productId: number): Promise<boolean> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query<ProductRow>('DELETE FROM products WHERE id = $1 RETURNING *', [productId]);

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    // Fecha o espaço: todo produto que estava depois do removido avança uma posição pra trás.
    await client.query('UPDATE products SET position = position - 1 WHERE position > $1', [rows[0].position]);

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function editProduct(productId: number, patch: ProductUpdate): Promise<Product | undefined> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: currentRows } = await client.query<ProductRow>(
      'SELECT * FROM products WHERE id = $1 FOR UPDATE',
      [productId]
    );

    if (currentRows.length === 0) {
      await client.query('ROLLBACK');
      return undefined;
    }

    const current = mapRow(currentRows[0]);
    const currentPosition = current.position as number;

    if (patch.position !== undefined && patch.position !== currentPosition) {
      const { rows: countRows } = await client.query('SELECT COUNT(*)::int AS count FROM products');
      const total = countRows[0].count as number;
      const newPosition = Math.max(1, Math.min(patch.position, total));

      if (newPosition > currentPosition) {
        // Movendo pra frente na lista: quem estava entre a posição antiga e a nova recua uma posição.
        await client.query(
          'UPDATE products SET position = position - 1 WHERE position > $1 AND position <= $2',
          [currentPosition, newPosition]
        );
      } else if (newPosition < currentPosition) {
        // Movendo pra trás na lista: quem estava entre a nova posição e a antiga avança uma posição.
        await client.query(
          'UPDATE products SET position = position + 1 WHERE position >= $1 AND position < $2',
          [newPosition, currentPosition]
        );
      }

      await client.query('UPDATE products SET position = $2 WHERE id = $1', [productId, newPosition]);
    }

    await client.query(
      'UPDATE products SET name=$2, description=$3, price=$4, delivery_message=$5, updated_at=now() WHERE id=$1',
      [
        productId,
        patch.name ?? current.name,
        patch.description ?? current.description,
        patch.price ?? current.price,
        patch.deliveryMessage ?? current.deliveryMessage
      ]
    );

    const { rows: finalRows } = await client.query<ProductRow>('SELECT * FROM products WHERE id = $1', [productId]);

    await client.query('COMMIT');
    return mapRow(finalRows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
