import type { Client } from 'discord.js';
import { formatPrice } from './format.js';
import { logAdmin, logSale, LOG_COLOR } from './logging.js';
import type { Order } from './store.js';

export type DeliveryResult = {
  roleGranted: boolean;
  roleAttempted: boolean;
  dmSent: boolean;
};

/**
 * Executa a entrega de um pedido aprovado: atribui o cargo do Discord configurado no produto
 * (se houver) e envia a mensagem de entrega por DM ao comprador. Nunca lança exceção — falhas
 * são registradas no log e refletidas no retorno, para não travar o fluxo de aprovação do pagamento.
 */
export async function deliverOrder(client: Client, order: Order): Promise<DeliveryResult> {
  let roleGranted = false;
  const roleAttempted = Boolean(order.guildId && order.product.deliveryRoleId);

  if (order.guildId && order.product.deliveryRoleId) {
    try {
      const guild = await client.guilds.fetch(order.guildId);
      const member = await guild.members.fetch(order.userId);
      await member.roles.add(order.product.deliveryRoleId, `Compra aprovada — pedido ${order.id}`);
      roleGranted = true;
    } catch (error) {
      console.error(
        `Falha ao atribuir o cargo de entrega (${order.product.deliveryRoleId}) do pedido ${order.id} para o usuário ${order.userId}:`,
        error
      );
      await logAdmin(client, {
        title: '⚠️ Falha ao atribuir cargo de entrega',
        description:
          `**Pedido:** \`${order.id}\`\n**Comprador:** <@${order.userId}>\n**Produto:** ${order.product.name}\n` +
          `**Cargo:** <@&${order.product.deliveryRoleId}>\n\nVerifique se o bot tem a permissão **Gerenciar Cargos** e se o cargo dele está posicionado acima do cargo de entrega.`,
        color: LOG_COLOR.warning
      });
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
        ? '\n\n🎭 O cargo de acesso foi liberado automaticamente pra você no servidor.'
        : '\n\n⚠️ Não consegui atribuir o cargo automaticamente — avise um administrador do servidor pra liberar manualmente.';

    await user.send(`✅ Pagamento aprovado para **${order.product.name}**.\n${order.product.deliveryMessage}${roleNote}`);
    dmSent = true;
  } catch (error) {
    console.error(`Falha ao enviar DM de confirmação do pedido ${order.id} para o usuário ${order.userId}:`, error);
  }

  await logSale(client, {
    title: '✅ Pagamento aprovado',
    description:
      `**Comprador:** <@${order.userId}> (\`${order.userId}\`)\n**Produto:** ${order.product.name}\n` +
      `**Valor:** R$ ${formatPrice(order.product.price)}\n**Pedido:** \`${order.id}\`\n**ID pagamento (Mercado Pago):** \`${order.paymentId ?? '—'}\`` +
      (order.product.deliveryRoleId ? `\n**Cargo entregue:** ${roleGranted ? '✅ Sim' : '❌ Não (verifique o log admin)'}` : ''),
    color: LOG_COLOR.approved
  });

  return { roleGranted, roleAttempted, dmSent };
}
