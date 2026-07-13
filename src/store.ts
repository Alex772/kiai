import { query } from './db.js';
import type { Duration } from './duration.js';
import type { Product } from './products.js';

export type OrderStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type PaymentMethod = 'pix' | 'card';

/** Tempo (em minutos) que um pedido pode ficar pendente sem pagamento antes de expirar automaticamente. */
export const ORDER_EXPIRATION_MINUTES = 60;

export type Order = {
  id: string;
  userId: string;
  guildId?: string;
  product: Product;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentId?: string;
  qrCode?: string;
  qrCodeBase64?: string;
  checkoutUrl?: string;
  /** Quando o cargo de entrega (se houver) deve ser removido automaticamente. Undefined = permanente. */
  roleExpiresAt?: string;
  /** Quando o cargo foi de fato removido pela expiração (marca o evento como já processado). */
  roleRemovedAt?: string;
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
  product_delivery_role_duration_amount: number | null;
  product_delivery_role_duration_unit: string | null;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_id: string | null;
  qr_code: string | null;
  qr_code_base64: string | null;
  checkout_url: string | null;
  role_expires_at: string | null;
  role_removed_at: string | null;
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
      deliveryRoleId: row.product_delivery_role_id ?? undefined,
      deliveryRoleDuration:
        row.product_delivery_role_duration_amount && row.product_delivery_role_duration_unit
          ? { amount: row.product_delivery_role_duration_amount, unit: row.product_delivery_role_duration_unit as Duration['unit'] }
          : undefined
    },
    status: row.status,
    paymentMethod: row.payment_method ?? 'pix',
    paymentId: row.payment_id ?? undefined,
    qrCode: row.qr_code ?? undefined,
    qrCodeBase64: row.qr_code_base64 ?? undefined,
    checkoutUrl: row.checkout_url ?? undefined,
    roleExpiresAt: row.role_expires_at ?? undefined,
    roleRemovedAt: row.role_removed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function createOrder(input: {
  id: string;
  userId: string;
  guildId?: string;
  product: Product;
  paymentMethod: PaymentMethod;
}): Promise<Order> {
  const rows = await query<OrderRow>(
    `INSERT INTO orders (
       id, user_id, guild_id, product_id, product_name, product_description, product_price,
       product_delivery_message, product_delivery_role_id, product_delivery_role_duration_amount,
       product_delivery_role_duration_unit, payment_method, status
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending') RETURNING *`,
    [
      input.id,
      input.userId,
      input.guildId ?? null,
      String(input.product.id),
      input.product.name,
      input.product.description,
      input.product.price,
      input.product.deliveryMessage,
      input.product.deliveryRoleId ?? null,
      input.product.deliveryRoleDuration?.amount ?? null,
      input.product.deliveryRoleDuration?.unit ?? null,
      input.paymentMethod
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
 * Busca um pedido pendente recente do mesmo usuário, produto e forma de pagamento, dentro da
 * janela de expiração. Usado para evitar gerar cobranças duplicadas quando o usuário clica em
 * "Comprar" (ou escolhe a mesma forma de pagamento) mais de uma vez.
 */
export async function findRecentPendingOrder(
  userId: string,
  productId: number,
  paymentMethod: PaymentMethod
): Promise<Order | undefined> {
  const rows = await query<OrderRow>(
    `SELECT * FROM orders
     WHERE user_id = $1 AND product_id = $2 AND payment_method = $3 AND status = 'pending'
       AND created_at > now() - ($4 || ' minutes')::interval
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, String(productId), paymentMethod, ORDER_EXPIRATION_MINUTES]
  );
  return rows[0] ? mapRow(rows[0]) : undefined;
}

/**
 * Lista todo pedido PIX ainda pendente que já tem um paymentId (usado pela verificação automática).
 */
export async function listPendingOrdersWithPayment(): Promise<Order[]> {
  const rows = await query<OrderRow>(
    `SELECT * FROM orders WHERE status = 'pending' AND payment_id IS NOT NULL ORDER BY created_at ASC`
  );
  return rows.map(mapRow);
}

/**
 * Lista todo pedido de cartão ainda pendente que AINDA NÃO tem um paymentId (o comprador pode não
 * ter terminado o checkout, ou terminou mas o webhook não chegou). Usado pela verificação
 * automática pra descobrir, via busca por external_reference, se algum desses já foi pago.
 */
export async function listPendingCardOrdersWithoutPayment(): Promise<Order[]> {
  const rows = await query<OrderRow>(
    `SELECT * FROM orders
     WHERE status = 'pending' AND payment_method = 'card' AND payment_id IS NULL
       AND created_at > now() - ($1 || ' minutes')::interval
     ORDER BY created_at ASC`,
    [ORDER_EXPIRATION_MINUTES]
  );
  return rows.map(mapRow);
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

/**
 * Lista pedidos aprovados com cargo de entrega temporário cujo prazo já venceu e que ainda não
 * foram processados (role_removed_at IS NULL). Usado pelo job de expiração automática de cargos.
 */
export async function listExpiredRoleGrants(): Promise<Order[]> {
  const rows = await query<OrderRow>(
    `SELECT * FROM orders
     WHERE status = 'approved' AND product_delivery_role_id IS NOT NULL
       AND role_expires_at IS NOT NULL AND role_expires_at <= now() AND role_removed_at IS NULL
     ORDER BY role_expires_at ASC`
  );
  return rows.map(mapRow);
}

/**
 * Lista os benefícios (cargos) ativos de um usuário — pedidos aprovados com cargo de entrega que
 * ainda não foi removido. Usado por /meusbeneficios e pelo comando administrativo de consulta.
 */
export async function listActiveRoleGrantsForUser(userId: string): Promise<Order[]> {
  const rows = await query<OrderRow>(
    `SELECT * FROM orders
     WHERE user_id = $1 AND status = 'approved' AND product_delivery_role_id IS NOT NULL AND role_removed_at IS NULL
     ORDER BY role_expires_at ASC NULLS LAST`,
    [userId]
  );
  return rows.map(mapRow);
}

export async function updateOrder(
  orderId: string,
  patch: Partial<
    Pick<Order, 'status' | 'paymentId' | 'qrCode' | 'qrCodeBase64' | 'checkoutUrl' | 'roleExpiresAt' | 'roleRemovedAt'>
  >
): Promise<Order | undefined> {
  const current = await getOrder(orderId);
  if (!current) return undefined;

  const updated = { ...current, ...patch };

  await query(
    `UPDATE orders SET status=$2, payment_id=$3, qr_code=$4, qr_code_base64=$5, checkout_url=$6,
       role_expires_at=$7, role_removed_at=$8, updated_at=now()
     WHERE id=$1`,
    [
      orderId,
      updated.status,
      updated.paymentId ?? null,
      updated.qrCode ?? null,
      updated.qrCodeBase64 ?? null,
      updated.checkoutUrl ?? null,
      updated.roleExpiresAt ?? null,
      updated.roleRemovedAt ?? null
    ]
  );

  return updated;
}
