import { randomUUID } from 'node:crypto';
import { client } from './client.js';
import { formatPrice } from './format.js';
import { logSale, LOG_COLOR } from './logging.js';
import { createPixPayment, createCardCheckoutLink } from './mercadoPago.js';
import type { Product } from './products.js';
import { createOrder, findRecentPendingOrder, updateOrder } from './store.js';

export async function buildPixOrder(userId: string, guildId: string, product: Product) {
  const existing = await findRecentPendingOrder(userId, product.id, 'pix');

  if (existing && existing.paymentId && existing.qrCode) {
    return {
      order: existing,
      pix: { paymentId: existing.paymentId, qrCode: existing.qrCode, qrCodeBase64: existing.qrCodeBase64 },
      reused: true
    };
  }

  const order = await createOrder({ id: randomUUID(), userId, guildId, product, paymentMethod: 'pix' });
  const pix = await createPixPayment(order);
  const updated = await updateOrder(order.id, {
    paymentId: pix.paymentId,
    qrCode: pix.qrCode,
    qrCodeBase64: pix.qrCodeBase64
  });

  await logSale(client, guildId, {
    title: '🛒 Pedido criado (PIX)',
    description:
      `**Comprador:** <@${userId}> (\`${userId}\`)\n**Produto:** ${product.name}\n**Valor:** R$ ${formatPrice(product.price)}\n**Pedido:** \`${order.id}\``,
    color: LOG_COLOR.created
  });

  return { order: updated ?? order, pix, reused: false };
}

export async function buildCardOrder(userId: string, guildId: string, product: Product) {
  const existing = await findRecentPendingOrder(userId, product.id, 'card');

  if (existing && existing.checkoutUrl) {
    return { order: existing, checkoutUrl: existing.checkoutUrl, reused: true };
  }

  const order = await createOrder({ id: randomUUID(), userId, guildId, product, paymentMethod: 'card' });
  const { checkoutUrl } = await createCardCheckoutLink(order);
  const updated = await updateOrder(order.id, { checkoutUrl });

  await logSale(client, guildId, {
    title: '🛒 Pedido criado (Cartão)',
    description:
      `**Comprador:** <@${userId}> (\`${userId}\`)\n**Produto:** ${product.name}\n**Valor:** R$ ${formatPrice(product.price)}\n**Pedido:** \`${order.id}\``,
    color: LOG_COLOR.created
  });

  return { order: updated ?? order, checkoutUrl, reused: false };
}
