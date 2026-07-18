import { TextDisplayBuilder } from 'discord.js';
import { formatPrice } from './format.js';
import { formatRemaining } from './duration.js';
import type { Order } from './store.js';

export const STATUS_LABEL: Record<Order['status'], string> = {
  pending: '⏳ Pendente',
  approved: '✅ Aprovado',
  rejected: '❌ Rejeitado',
  cancelled: '🚫 Cancelado',
  refunded: '↩️ Reembolsado',
  charged_back: '⚠️ Contestado (chargeback)'
};

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function orderDetailContent(order: Order) {
  const lines = [
    `## 📦 Pedido`,
    `**ID:** \`${order.id}\``,
    `**Produto:** ${order.product.name}`,
    `**Valor:** R$ ${formatPrice(order.product.price)}`,
    `**Forma de pagamento:** ${order.paymentMethod === 'pix' ? '💠 PIX' : '💳 Cartão'}`,
    `**Status:** ${STATUS_LABEL[order.status]}`,
    order.product.deliveryRoleId ? `**Cargo de entrega:** <@&${order.product.deliveryRoleId}>` : undefined,
    order.paymentId ? `**ID do pagamento (Mercado Pago):** \`${order.paymentId}\`` : undefined,
    `**Criado em:** ${formatDate(order.createdAt)}`,
    `**Última atualização:** ${formatDate(order.updatedAt)}`
  ].filter(Boolean);

  return lines.join('\n');
}

export function orderSummaryLine(order: Order) {
  return `**${order.product.name}** — R$ ${formatPrice(order.product.price)} — ${order.paymentMethod === 'pix' ? '💠' : '💳'} — ${STATUS_LABEL[order.status]}\n\`${order.id}\` • ${formatDate(order.createdAt)}`;
}

export function benefitsSectionContent(title: string, grants: Order[]) {
  if (grants.length === 0) {
    return new TextDisplayBuilder().setContent(`${title}\nNenhum benefício ativo no momento.`);
  }

  const lines = grants.map((order) => {
    const roleMention = order.product.deliveryRoleId ? `<@&${order.product.deliveryRoleId}>` : order.product.name;
    if (!order.roleExpiresAt) {
      return `${roleMention} — **permanente** (\`${order.id}\`)`;
    }
    const expiresAt = new Date(order.roleExpiresAt);
    return `${roleMention} — expira em **${formatRemaining(expiresAt)}** (${formatDate(order.roleExpiresAt)}) — \`${order.id}\``;
  });

  return new TextDisplayBuilder().setContent(`${title}\n${lines.join('\n')}`);
}
