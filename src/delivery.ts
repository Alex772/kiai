import type { Client } from 'discord.js';
import { addDurationToDate, formatDuration, formatRemaining } from './duration.js';
import { formatPrice } from './format.js';
import { logAdmin, logSale, LOG_COLOR } from './logging.js';
import { updateOrder, type Order } from './store.js';

export type DeliveryResult = {
  roleGranted: boolean;
  roleAttempted: boolean;
  dmSent: boolean;
};

/**
 * Executa a entrega de um pedido aprovado: atribui o cargo do Discord configurado no produto
 * (se houver, com prazo de expiração se configurado) e envia a mensagem de entrega por DM ao
 * comprador. Nunca lança exceção — falhas são registradas no log e refletidas no retorno, para
 * não travar o fluxo de aprovação do pagamento.
 */
export async function deliverOrder(client: Client, order: Order): Promise<DeliveryResult> {
  let roleGranted = false;
  const roleAttempted = Boolean(order.guildId && order.product.deliveryRoleId);
  let roleExpiresAt: Date | undefined;

  if (order.guildId && order.product.deliveryRoleId) {
    try {
      const guild = await client.guilds.fetch(order.guildId);
      const member = await guild.members.fetch(order.userId);
      await member.roles.add(order.product.deliveryRoleId, `Compra aprovada — pedido ${order.id}`);
      roleGranted = true;

      if (order.product.deliveryRoleDuration) {
        roleExpiresAt = addDurationToDate(new Date(), order.product.deliveryRoleDuration);
        await updateOrder(order.id, { roleExpiresAt: roleExpiresAt.toISOString() });
      }
    } catch (error) {
      console.error(
        `Falha ao atribuir o cargo de entrega (${order.product.deliveryRoleId}) do pedido ${order.id} para o usuário ${order.userId}:`,
        error
      );
      if (order.guildId) {
        await logAdmin(client, order.guildId, {
          title: '⚠️ Falha ao atribuir cargo de entrega',
          description:
            `**Pedido:** \`${order.id}\`\n**Comprador:** <@${order.userId}>\n**Produto:** ${order.product.name}\n` +
            `**Cargo:** <@&${order.product.deliveryRoleId}>\n\nVerifique se o bot tem a permissão **Gerenciar Cargos** e se o cargo dele está posicionado acima do cargo de entrega.`,
          color: LOG_COLOR.warning
        });
      }
    }
  } else if (order.product.deliveryRoleId && !order.guildId) {
    console.error(
      `Pedido ${order.id} tem cargo de entrega configurado, mas não tem guildId salvo (pedido criado antes dessa funcionalidade). Cargo não atribuído automaticamente.`
    );
  }

  let dmSent = false;

  try {
    const user = await client.users.fetch(order.userId);
    const roleNote = !order.product.deliveryRoleId
      ? ''
      : roleGranted
        ? roleExpiresAt
          ? `\n\n🎭 O cargo de acesso foi liberado por ${formatDuration(order.product.deliveryRoleDuration!)} (até ${roleExpiresAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}).`
          : '\n\n🎭 O cargo de acesso foi liberado automaticamente pra você no servidor (sem prazo de validade).'
        : '\n\n⚠️ Não consegui atribuir o cargo automaticamente — avise um administrador do servidor pra liberar manualmente.';

    await user.send(`✅ Pagamento aprovado para **${order.product.name}**.\n${order.product.deliveryMessage}${roleNote}`);
    dmSent = true;
  } catch (error) {
    console.error(`Falha ao enviar DM de confirmação do pedido ${order.id} para o usuário ${order.userId}:`, error);
  }

  if (order.guildId) {
    await logSale(client, order.guildId, {
      title: '✅ Pagamento aprovado',
      description:
        `**Comprador:** <@${order.userId}> (\`${order.userId}\`)\n**Produto:** ${order.product.name}\n` +
        `**Valor:** R$ ${formatPrice(order.product.price)}\n**Pedido:** \`${order.id}\`\n**ID pagamento (Mercado Pago):** \`${order.paymentId ?? '—'}\`` +
        (order.product.deliveryRoleId
          ? `\n**Cargo entregue:** ${roleGranted ? '✅ Sim' : '❌ Não (verifique o log admin)'}` +
            (roleExpiresAt ? `\n**Cargo expira em:** ${formatRemaining(roleExpiresAt)}` : '')
          : ''),
      color: LOG_COLOR.approved
    });
  }

  return { roleGranted, roleAttempted, dmSent };
}

export type RevokeReason = 'refunded' | 'charged_back';

export type RevokeResult = {
  roleRemoved: boolean;
};

const REVOKE_LABEL: Record<RevokeReason, string> = {
  refunded: 'reembolsado',
  charged_back: 'contestado (chargeback)'
};

/**
 * Reverte um pedido que já tinha sido aprovado, mas o Mercado Pago avisou que o pagamento foi
 * reembolsado ou contestado depois. Remove o cargo de entrega (se houver) e avisa o comprador por
 * DM. Nunca lança exceção — falhas são registradas no log e refletidas no retorno.
 */
export async function revokeOrder(client: Client, order: Order, reason: RevokeReason): Promise<RevokeResult> {
  let roleRemoved = false;
  const label = REVOKE_LABEL[reason];

  if (order.guildId && order.product.deliveryRoleId) {
    try {
      const guild = await client.guilds.fetch(order.guildId);
      const member = await guild.members.fetch(order.userId).catch(() => undefined);

      if (member) {
        await member.roles.remove(order.product.deliveryRoleId, `Pagamento ${label} — pedido ${order.id}`);
        roleRemoved = true;
      }
    } catch (error) {
      console.error(`Falha ao remover cargo do pedido ${order.id} (${label}):`, error);
    }
  }

  await updateOrder(order.id, { status: reason, roleRemovedAt: new Date().toISOString() });

  try {
    const user = await client.users.fetch(order.userId);
    await user.send(
      `↩️ Seu pagamento de **${order.product.name}** foi ${label}.${roleRemoved ? ' O acesso correspondente foi removido.' : ''}`
    );
  } catch (error) {
    console.error(`Falha ao avisar por DM sobre ${label} do pedido ${order.id}:`, error);
  }

  if (order.guildId) {
    await logSale(client, order.guildId, {
      title: reason === 'refunded' ? '↩️ Pagamento reembolsado' : '⚠️ Chargeback (contestação)',
      description: `<@${order.userId}> — ${order.product.name} — R$ ${formatPrice(order.product.price)} (\`${order.id}\`)`,
      color: LOG_COLOR.warning
    });

    await logAdmin(client, order.guildId, {
      title: reason === 'refunded' ? '↩️ Pagamento reembolsado — cargo revogado' : '⚠️ Chargeback — cargo revogado',
      description:
        `**Usuário:** <@${order.userId}>\n**Produto:** ${order.product.name}\n**Pedido:** \`${order.id}\`\n` +
        `**Cargo:** ${order.product.deliveryRoleId ? `<@&${order.product.deliveryRoleId}>` : '—'}\n` +
        `**Removido do Discord:** ${roleRemoved ? '✅ Sim' : order.product.deliveryRoleId ? '⚠️ Não (membro não encontrado, ou já sem o cargo)' : '—'}`,
      color: LOG_COLOR.warning
    });
  }

  return { roleRemoved };
}
