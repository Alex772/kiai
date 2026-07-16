import { ButtonInteraction, MessageFlags, TextDisplayBuilder, ContainerBuilder } from 'discord.js';
import { client } from '../../client.js';
import { deliverOrder } from '../../delivery.js';
import { resolveOrderPaymentStatus } from '../../mercadoPago.js';
import { buildCardOrder, buildPixOrder } from '../../orderService.js';
import { findProduct } from '../../products.js';
import { getOrder, updateOrder } from '../../store.js';
import { buildCardPaymentReply, buildPaymentMethodChoiceReply, buildPixPaymentReply } from '../../views/paymentViews.js';

/** Retorna true se tratou a interação (customId reconhecido), false caso contrário. */
export async function handlePaymentButtons(interaction: ButtonInteraction): Promise<boolean> {
  if (interaction.customId.startsWith('comprar:')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guildId) {
      await interaction.editReply('Esse comando só funciona dentro de um servidor.');
      return true;
    }

    const productId = Number(interaction.customId.replace('comprar:', ''));
    const product = await findProduct(interaction.guildId, productId);

    if (!product) {
      await interaction.editReply('Produto não encontrado (pode ter sido removido).');
      return true;
    }

    await interaction.editReply(buildPaymentMethodChoiceReply(product));
    return true;
  }

  if (interaction.customId.startsWith('pagarpix:')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guildId) {
      await interaction.editReply('Esse comando só funciona dentro de um servidor.');
      return true;
    }

    const productId = Number(interaction.customId.replace('pagarpix:', ''));
    const product = await findProduct(interaction.guildId, productId);

    if (!product) {
      await interaction.editReply('Produto não encontrado (pode ter sido removido).');
      return true;
    }

    const { order, pix, reused } = await buildPixOrder(interaction.user.id, interaction.guildId, product);

    if (!pix.paymentId || !pix.qrCode) {
      await interaction.editReply('Não foi possível gerar o PIX. Tente novamente em alguns minutos.');
      return true;
    }

    await interaction.editReply(buildPixPaymentReply(order, pix, reused));
    return true;
  }

  if (interaction.customId.startsWith('pagarcartao:')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guildId) {
      await interaction.editReply('Esse comando só funciona dentro de um servidor.');
      return true;
    }

    const productId = Number(interaction.customId.replace('pagarcartao:', ''));
    const product = await findProduct(interaction.guildId, productId);

    if (!product) {
      await interaction.editReply('Produto não encontrado (pode ter sido removido).');
      return true;
    }

    const { order, checkoutUrl, reused } = await buildCardOrder(interaction.user.id, interaction.guildId, product);

    if (!checkoutUrl) {
      await interaction.editReply(
        'Não foi possível gerar o link de pagamento com cartão. Verifique se `PUBLIC_BASE_URL` está configurado, ou tente novamente em alguns minutos.'
      );
      return true;
    }

    await interaction.editReply(buildCardPaymentReply(order, checkoutUrl, reused));
    return true;
  }

  if (interaction.customId.startsWith('check:')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const orderId = interaction.customId.replace('check:', '');
    const order = await getOrder(orderId);

    if (!order || order.userId !== interaction.user.id) {
      await interaction.editReply('Pedido não encontrado para sua conta.');
      return true;
    }

    const { status, paymentId } = await resolveOrderPaymentStatus(order);

    const container = new ContainerBuilder();

    if (status === 'approved') {
      const alreadyApproved = order.status === 'approved';
      const updated = await updateOrder(order.id, { status: 'approved', paymentId: paymentId ?? order.paymentId });

      if (!alreadyApproved) {
        await deliverOrder(client, updated ?? order);
      }

      const roleNote = order.product.deliveryRoleId ? '\n🎭 O cargo de acesso foi liberado automaticamente pra você.' : '';
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ✅ Pagamento aprovado!\n${order.product.deliveryMessage}${roleNote}`)
      );
    } else {
      if (paymentId && paymentId !== order.paymentId) {
        await updateOrder(order.id, { paymentId });
      }

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ⏳ Pagamento pendente\nStatus atual no Mercado Pago: **${status ?? 'ainda não iniciado'}**`
        )
      );
    }

    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return true;
  }

  return false;
}
