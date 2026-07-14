import { pool, query } from './db.js';
import type { Duration } from './duration.js';

export type Product = {
  id: number;
  name: string;
  description: string;
  price: number;
  deliveryMessage: string;
  /** Cargo do Discord entregue automaticamente ao aprovar o pagamento (opcional). */
  deliveryRoleId?: string;
  /** Por quanto tempo o cargo fica ativo antes de ser removido automaticamente. Sem isso, é permanente. */
  deliveryRoleDuration?: Duration;
  position?: number;
};

export type ProductInput = {
  name: string;
  description: string;
  price: number;
  deliveryMessage: string;
  deliveryRoleId?: string;
  deliveryRoleDuration?: Duration;
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
  delivery_role_id: string | null;
  delivery_role_duration_amount: number | null;
  delivery_role_duration_unit: string | null;
  position: number;
};

function mapRow(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    deliveryMessage: row.delivery_message,
    deliveryRoleId: row.delivery_role_id ?? undefined,
    deliveryRoleDuration:
      row.delivery_role_duration_amount && row.delivery_role_duration_unit
        ? { amount: row.delivery_role_duration_amount, unit: row.delivery_role_duration_unit as Duration['unit'] }
        : undefined,
    position: row.position
  };
}

export async function listProducts(guildId: string): Promise<Product[]> {
  const rows = await query<ProductRow>('SELECT * FROM products WHERE guild_id = $1 ORDER BY position ASC, id ASC', [guildId]);
  return rows.map(mapRow);
}

/** Busca um produto garantindo que ele pertence ao servidor informado (isolamento entre lojas). */
export async function findProduct(guildId: string, productId: number): Promise<Product | undefined> {
  const rows = await query<ProductRow>('SELECT * FROM products WHERE id = $1 AND guild_id = $2', [productId, guildId]);
  return rows[0] ? mapRow(rows[0]) : undefined;
}

export async function countProducts(guildId: string): Promise<number> {
  const rows = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM products WHERE guild_id = $1', [guildId]);
  return rows[0]?.count ?? 0;
}

export async function addProduct(guildId: string, input: ProductInput): Promise<Product> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: countRows } = await client.query('SELECT COUNT(*)::int AS count FROM products WHERE guild_id = $1', [guildId]);
    const total = countRows[0].count as number;
    const targetPosition = input.position && input.position >= 1 ? Math.min(input.position, total + 1) : total + 1;

    // Abre espaço na posição desejada, empurrando os produtos seguintes DESSE SERVIDOR uma posição pra frente.
    await client.query('UPDATE products SET position = position + 1 WHERE guild_id = $1 AND position >= $2', [
      guildId,
      targetPosition
    ]);

    const { rows } = await client.query<ProductRow>(
      `INSERT INTO products (guild_id, name, description, price, delivery_message, delivery_role_id, delivery_role_duration_amount, delivery_role_duration_unit, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        guildId,
        input.name,
        input.description,
        input.price,
        input.deliveryMessage,
        input.deliveryRoleId ?? null,
        input.deliveryRoleDuration?.amount ?? null,
        input.deliveryRoleDuration?.unit ?? null,
        targetPosition
      ]
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

export async function removeProduct(guildId: string, productId: number): Promise<boolean> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query<ProductRow>('DELETE FROM products WHERE id = $1 AND guild_id = $2 RETURNING *', [
      productId,
      guildId
    ]);

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    // Fecha o espaço: todo produto DESSE SERVIDOR que estava depois do removido recua uma posição.
    await client.query('UPDATE products SET position = position - 1 WHERE guild_id = $1 AND position > $2', [
      guildId,
      rows[0].position
    ]);

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function editProduct(guildId: string, productId: number, patch: ProductUpdate): Promise<Product | undefined> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: currentRows } = await client.query<ProductRow>(
      'SELECT * FROM products WHERE id = $1 AND guild_id = $2 FOR UPDATE',
      [productId, guildId]
    );

    if (currentRows.length === 0) {
      await client.query('ROLLBACK');
      return undefined;
    }

    const current = mapRow(currentRows[0]);
    const currentPosition = current.position as number;

    if (patch.position !== undefined && patch.position !== currentPosition) {
      const { rows: countRows } = await client.query('SELECT COUNT(*)::int AS count FROM products WHERE guild_id = $1', [guildId]);
      const total = countRows[0].count as number;
      const newPosition = Math.max(1, Math.min(patch.position, total));

      if (newPosition > currentPosition) {
        // Movendo pra frente na lista: quem estava entre a posição antiga e a nova recua uma posição.
        await client.query(
          'UPDATE products SET position = position - 1 WHERE guild_id = $1 AND position > $2 AND position <= $3',
          [guildId, currentPosition, newPosition]
        );
      } else if (newPosition < currentPosition) {
        // Movendo pra trás na lista: quem estava entre a nova posição e a antiga avança uma posição.
        await client.query(
          'UPDATE products SET position = position + 1 WHERE guild_id = $1 AND position >= $2 AND position < $3',
          [guildId, newPosition, currentPosition]
        );
      }

      await client.query('UPDATE products SET position = $3 WHERE id = $1 AND guild_id = $2', [productId, guildId, newPosition]);
    }

    await client.query(
      'UPDATE products SET name=$3, description=$4, price=$5, delivery_message=$6, updated_at=now() WHERE id=$1 AND guild_id=$2',
      [
        productId,
        guildId,
        patch.name ?? current.name,
        patch.description ?? current.description,
        patch.price ?? current.price,
        patch.deliveryMessage ?? current.deliveryMessage
      ]
    );

    const { rows: finalRows } = await client.query<ProductRow>('SELECT * FROM products WHERE id = $1 AND guild_id = $2', [
      productId,
      guildId
    ]);

    await client.query('COMMIT');
    return mapRow(finalRows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Define (ou remove, passando null) o cargo do Discord entregue automaticamente
 * quando o pagamento desse produto for aprovado.
 */
export async function setProductDeliveryRole(guildId: string, productId: number, roleId: string | null): Promise<Product | undefined> {
  const rows = await query<ProductRow>(
    'UPDATE products SET delivery_role_id = $3, updated_at = now() WHERE id = $1 AND guild_id = $2 RETURNING *',
    [productId, guildId, roleId]
  );
  return rows[0] ? mapRow(rows[0]) : undefined;
}

/**
 * Define (ou remove, passando null) por quanto tempo o cargo de entrega desse produto fica ativo
 * antes de ser removido automaticamente. Sem duração definida, o cargo é permanente.
 */
export async function setProductDeliveryRoleDuration(
  guildId: string,
  productId: number,
  duration: Duration | null
): Promise<Product | undefined> {
  const rows = await query<ProductRow>(
    'UPDATE products SET delivery_role_duration_amount = $3, delivery_role_duration_unit = $4, updated_at = now() WHERE id = $1 AND guild_id = $2 RETURNING *',
    [productId, guildId, duration?.amount ?? null, duration?.unit ?? null]
  );
  return rows[0] ? mapRow(rows[0]) : undefined;
}
