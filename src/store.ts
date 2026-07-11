import { query } from './db.js';
import type { Product } from './products.js';

export type OrderStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** Tempo (em minutos) que um pedido pode ficar pendente sem pagamento antes de expirar automaticamente. */
export const ORDER_EXPIRATION_MINUTES = 60;

export type Order = {
  id: string;
  userId: string;
  guildId?: string;
  product: Product;
  status: OrderStatus;
  paymentId?: string;
  qrCode?: string;
  qrCodeBase64?: string;
  createdAt: string;
  updatedAt: string;
};

type OrderRow = {
  id: string;
  user_id: string;
  guild_id: string | null;
  product_id: string;
  product_name: string;
  product_description: string;
  product_price: string;
  product_delivery_message: string;
  product_delivery_role_id: string | null;
  status: OrderStatus;
  payment_id: string | null;
  qr_code: string | null;
  qr_code_base64: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: OrderRow): Order {
  return {
    id: row.id,
    userId: row.user_id,
    guildId: row.guild_id ?? undefined,
    product: {
      id: Number(row.product_id),
      name: row.product_name,
      description: row.product_description,
      price: Number(row.product_price),
      deliveryMessage: row.product_delivery_message,
      deliveryRoleId: row.product_delivery_role_id ?? undefined
    },
    status: row.status,
    paymentId: row.payment_id ?? undefined,
    qrCode: row.qr_code ?? undefined,
    qrCodeBase64: row.qr_code_base64 ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function createOrder(input: {
  id: string;
  userId: string;
  guildId?: string;
  product: Product;
}): Promise<Order> {
  const rows = await query<OrderRow>(
    `INSERT INTO orders (id, user_id, guild_id, product_id, product_name, product_description, product_price, product_delivery_message, product_delivery_role_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') RETURNING *`,
    [
      input.id,
      input.userId,
      input.guildId ?? null,
      String(input.product.id),
      input.product.name,
      input.product.description,
      input.product.price,
      input.product.deliveryMessage,
      input.product.deliveryRoleId ?? null
    ]
  );
  return mapRow(rows[0]);
}

export async function getOrder(orderId: string): Promise<Order | undefined> {
  const rows = await query<OrderRow>('SELECT * FROM orders WHERE id = $1', [orderId]);
  return rows[0] ? mapRow(rows[0]) : undefined;
}

export async function findOrderByPaymentId(paymentId: string): Promise<Order | undefined> {
  const rows = await query<OrderRow>('SELECT * FROM orders WHERE payment_id = $1', [paymentId]);
  return rows[0] ? mapRow(rows[0]) : undefined;
}

export async function listOrdersByUser(userId: string, limit = 10): Promise<Order[]> {
  const rows = await query<OrderRow>(
    'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
  return rows.map(mapRow);
}

/**
 * Busca um pedido pendente recente do mesmo usuário para o mesmo produto, dentro da janela de expiração.
 * Usado para evitar gerar múltiplos PIX duplicados quando o usuário clica em "Comprar" mais de uma vez.
 */
export async function findRecentPendingOrder(userId: string, productId: number): Promise<Order | undefined> {
  const rows = await query<OrderRow>(
    `SELECT * FROM orders
     WHERE user_id = $1 AND product_id = $2 AND status = 'pending'
       AND created_at > now() - ($3 || ' minutes')::interval
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, String(productId), ORDER_EXPIRATION_MINUTES]
  );
  return rows[0] ? mapRow(rows[0]) : undefined;
}

/**
 * Marca como "cancelled" todo pedido pendente criado há mais de ORDER_EXPIRATION_MINUTES sem pagamento.
 * Retorna os pedidos que foram cancelados (útil para log).
 */
export async function cancelExpiredOrders(): Promise<Order[]> {
  const rows = await query<OrderRow>(
    `UPDATE orders SET status = 'cancelled', updated_at = now()
     WHERE status = 'pending' AND created_at <= now() - ($1 || ' minutes')::interval
     RETURNING *`,
    [ORDER_EXPIRATION_MINUTES]
  );
  return rows.map(mapRow);
}

export async function updateOrder(
  orderId: string,
  patch: Partial<Pick<Order, 'status' | 'paymentId' | 'qrCode' | 'qrCodeBase64'>>
): Promise<Order | undefined> {
  const current = await getOrder(orderId);
  if (!current) return undefined;

  const updated = { ...current, ...patch };

  await query(
    'UPDATE orders SET status=$2, payment_id=$3, qr_code=$4, qr_code_base64=$5, updated_at=now() WHERE id=$1',
    [orderId, updated.status, updated.paymentId ?? null, updated.qrCode ?? null, updated.qrCodeBase64 ?? null]
  );

  return updated;
}
