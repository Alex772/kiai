import { query } from './db.js';
import type { Product } from './products.js';

export type OrderStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type Order = {
  id: string;
  userId: string;
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
  product_id: string;
  product_name: string;
  product_description: string;
  product_price: string;
  product_delivery_message: string;
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
    product: {
      id: row.product_id,
      name: row.product_name,
      description: row.product_description,
      price: Number(row.product_price),
      deliveryMessage: row.product_delivery_message
    },
    status: row.status,
    paymentId: row.payment_id ?? undefined,
    qrCode: row.qr_code ?? undefined,
    qrCodeBase64: row.qr_code_base64 ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function createOrder(input: { id: string; userId: string; product: Product }): Promise<Order> {
  const rows = await query<OrderRow>(
    `INSERT INTO orders (id, user_id, product_id, product_name, product_description, product_price, product_delivery_message, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`,
    [
      input.id,
      input.userId,
      input.product.id,
      input.product.name,
      input.product.description,
      input.product.price,
      input.product.deliveryMessage
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
