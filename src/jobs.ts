import { client } from './client.js';
import { deliverOrder } from './delivery.js';
import { migrate } from './db.js';
import { formatPrice } from './format.js';
import { logAdmin, logSale, LOG_COLOR } from './logging.js';
import { getPaymentDetails, refreshConnection, searchPaymentByExternalReference } from './mercadoPago.js';
import { listConnectionsExpiringSoon } from './mpConnections.js';
import {
  cancelExpiredOrders,
  listExpiredRoleGrants,
  listPendingCardOrdersWithoutPayment,
  listPendingOrdersWithPayment,
  updateOrder,
  ORDER_EXPIRATION_MINUTES,
  type Order
} from './store.js';

export async function migrateWithRetry(maxAttempts = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await migrate();
      console.log('Banco de dados PostgreSQL pronto (tabelas verificadas/criadas).');
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isLastAttempt = attempt === maxAttempts;

      console.error(`Tentativa ${attempt}/${maxAttempts} de conectar ao banco de dados falhou: ${message}`);

      if (isLastAttempt) {
        console.error(
          'Não foi possível conectar ao banco de dados após várias tentativas. Verifique DATABASE_URL/DATABASE_PUBLIC_URL. O bot vai continuar rodando, mas comandos que dependem do banco vão falhar até o próximo redeploy.'
        );
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Marca como "cancelled" todo pedido pendente há mais de ORDER_EXPIRATION_MINUTES sem pagamento,
 * e registra um resumo no log de vendas de cada servidor afetado.
 */
async function cleanupExpiredOrdersJob() {
  try {
    const cancelled = await cancelExpiredOrders();
    if (cancelled.length > 0) {
      console.log(
        `${cancelled.length} pedido(s) pendente(s) expiraram (mais de ${ORDER_EXPIRATION_MINUTES} min sem pagamento) e foram marcados como cancelados.`
      );

      const byGuild = new Map<string, Order[]>();
      for (const order of cancelled) {
        if (!order.guildId) continue;
        const list = byGuild.get(order.guildId) ?? [];
        list.push(order);
        byGuild.set(order.guildId, list);
      }

      for (const [guildId, orders] of byGuild) {
        await logSale(client, guildId, {
          title: `🕐 ${orders.length} pedido(s) expirado(s)`,
          description: orders
            .map((o) => `<@${o.userId}> — ${o.product.name} — R$ ${formatPrice(o.product.price)} (\`${o.id}\`)`)
            .join('\n'),
          color: LOG_COLOR.expired
        });
      }
    }
  } catch (error) {
    console.error('Falha ao limpar pedidos expirados:', error);
  }
}

/**
 * Verificação automática de pagamentos pendentes — funciona como um "backup" caso a notificação
 * (webhook) do Mercado Pago não chegue por algum motivo. Cobre tanto PIX (paymentId já conhecido)
 * quanto cartão (paymentId só existe depois que o comprador termina o checkout).
 */
async function pollPendingPaymentsJob() {
  try {
    const pending = await listPendingOrdersWithPayment();

    for (const order of pending) {
      if (!order.paymentId) continue;

      try {
        if (!order.guildId) continue;
        const status = await getPaymentDetails(order.paymentId, order.guildId).then((d) => d.status);

        if (status === 'approved') {
          const updated = await updateOrder(order.id, { status: 'approved' });
          await deliverOrder(client, updated ?? order);
          console.log(`Pedido ${order.id} aprovado detectado pela verificação automática (webhook não chegou a tempo).`);
        } else if (status === 'rejected' || status === 'cancelled') {
          await updateOrder(order.id, { status: status === 'rejected' ? 'rejected' : 'cancelled' });
        }
      } catch (error) {
        console.error(`Falha ao verificar automaticamente o pagamento do pedido ${order.id}:`, error);
      }
    }

    const pendingCard = await listPendingCardOrdersWithoutPayment();

    for (const order of pendingCard) {
      try {
        if (!order.guildId) continue;
        const found = await searchPaymentByExternalReference(order.id, order.guildId);
        if (!found) continue;

        if (found.status === 'approved') {
          const updated = await updateOrder(order.id, { status: 'approved', paymentId: found.id });
          await deliverOrder(client, updated ?? order);
          console.log(`Pedido ${order.id} (cartão) aprovado detectado pela verificação automática.`);
        } else {
          await updateOrder(order.id, { paymentId: found.id });
        }
      } catch (error) {
        console.error(`Falha ao verificar automaticamente o pagamento (cartão) do pedido ${order.id}:`, error);
      }
    }
  } catch (error) {
    console.error('Falha ao rodar a verificação automática de pagamentos pendentes:', error);
  }
}

/**
 * Remove automaticamente o cargo de quem comprou um benefício por tempo limitado, assim que o
 * prazo vence. Avisa o comprador por DM e registra nos dois canais de log (vendas e admin).
 */
async function expireRoleGrantsJob() {
  try {
    const expired = await listExpiredRoleGrants();

    for (const order of expired) {
      try {
        let removed = false;

        if (order.guildId && order.product.deliveryRoleId) {
          try {
            const guild = await client.guilds.fetch(order.guildId);
            const member = await guild.members.fetch(order.userId).catch(() => undefined);
            if (member) {
              await member.roles.remove(order.product.deliveryRoleId, `Benefício expirado — pedido ${order.id}`);
              removed = true;
            }
          } catch (error) {
            console.error(`Falha ao remover cargo expirado do pedido ${order.id}:`, error);
          }
        }

        await updateOrder(order.id, { roleRemovedAt: new Date().toISOString() });

        try {
          const user = await client.users.fetch(order.userId);
          await user.send(
            `⏰ Seu acesso de **${order.product.name}** expirou${removed ? ' e o cargo foi removido' : ''}. Se quiser continuar com acesso, é só comprar de novo!`
          );
        } catch (error) {
          console.error(`Falha ao avisar por DM sobre expiração do pedido ${order.id}:`, error);
        }

        if (order.guildId) {
          await logSale(client, order.guildId, {
            title: '⏰ Benefício expirado',
            description: `<@${order.userId}> — ${order.product.name} (\`${order.id}\`)`,
            color: LOG_COLOR.expired
          });

          await logAdmin(client, order.guildId, {
            title: '⏰ Cargo removido automaticamente (prazo expirado)',
            description:
              `**Usuário:** <@${order.userId}>\n**Produto:** ${order.product.name}\n` +
              `**Cargo:** ${order.product.deliveryRoleId ? `<@&${order.product.deliveryRoleId}>` : '—'}\n**Pedido:** \`${order.id}\`\n` +
              `**Removido do Discord:** ${removed ? '✅ Sim' : '⚠️ Não (membro não encontrado no servidor, ou cargo já removido manualmente)'}`,
            color: LOG_COLOR.warning
          });
        }
      } catch (error) {
        console.error(`Falha ao processar expiração do pedido ${order.id}:`, error);
      }
    }
  } catch (error) {
    console.error('Falha ao rodar a expiração automática de cargos:', error);
  }
}

/**
 * Renova proativamente as conexões Mercado Pago que estão perto de vencer (não depende só de
 * alguém comprar algo pra disparar a renovação). Se a renovação falhar, avisa o dono do servidor
 * no log admin — provavelmente a conta revogou o acesso e precisa reconectar.
 */
async function renewExpiringMercadoPagoConnectionsJob() {
  try {
    const expiringSoon = await listConnectionsExpiringSoon(7);

    for (const connection of expiringSoon) {
      try {
        await refreshConnection(connection);
        console.log(`Conexão Mercado Pago do servidor ${connection.guildId} renovada automaticamente.`);
      } catch (error) {
        console.error(`Falha ao renovar conexão Mercado Pago do servidor ${connection.guildId}:`, error);
        await logAdmin(client, connection.guildId, {
          title: '⚠️ Conexão Mercado Pago não pôde ser renovada',
          description:
            `A conexão da conta Mercado Pago deste servidor está perto de vencer (ou já venceu) e não foi possível renovar automaticamente. ` +
            `Provavelmente a autorização foi revogada do lado do Mercado Pago. Rode \`/mercadopago conectar\` de novo pra não travar as vendas.`,
          color: LOG_COLOR.warning
        });
      }
    }
  } catch (error) {
    console.error('Falha ao rodar a renovação automática de conexões Mercado Pago:', error);
  }
}

const CLEANUP_INTERVAL_MS = 5 * 60_000; // roda a cada 5 minutos
const PAYMENT_POLL_INTERVAL_MS = 2 * 60_000; // roda a cada 2 minutos
const ROLE_EXPIRATION_INTERVAL_MS = 5 * 60_000; // roda a cada 5 minutos
const CONNECTION_RENEWAL_INTERVAL_MS = 24 * 60 * 60_000; // roda 1x por dia

/** Dispara todos os jobs periódicos do bot. Chamado uma vez, depois que o banco está pronto. */
export async function scheduleJobs() {
  await cleanupExpiredOrdersJob();
  setInterval(cleanupExpiredOrdersJob, CLEANUP_INTERVAL_MS);

  setInterval(pollPendingPaymentsJob, PAYMENT_POLL_INTERVAL_MS);

  await expireRoleGrantsJob();
  setInterval(expireRoleGrantsJob, ROLE_EXPIRATION_INTERVAL_MS);

  await renewExpiringMercadoPagoConnectionsJob();
  setInterval(renewExpiringMercadoPagoConnectionsJob, CONNECTION_RENEWAL_INTERVAL_MS);
}
