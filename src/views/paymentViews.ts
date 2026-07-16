import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ContainerBuilder
} from 'discord.js';
import { formatPrice } from '../format.js';
import type { Product } from '../products.js';
import { ORDER_EXPIRATION_MINUTES, type Order } from '../store.js';

export function buildPaymentMethodChoiceReply(product: Product) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${product.name}\n${product.description}\n\n**Valor:** R$ ${formatPrice(product.price)}\n\nComo você quer pagar?\n-# 💳 O pagamento por cartão atualmente exige entrar ou criar uma conta Mercado Pago na hora de pagar.`
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`pagarpix:${product.id}`).setLabel('💠 PIX').setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`pagarcartao:${product.id}`)
        .setLabel('💳 Cartão (requer conta Mercado Pago)')
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2 };
}

export function buildPixPaymentReply(order: Order, pix: { qrCode?: string; qrCodeBase64?: string }, reused = false) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 💠 Pagamento PIX — ${order.product.name}`)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      reused
        ? `**Pedido:** \`${order.id}\`\n**Valor:** R$ ${formatPrice(order.product.price)}\n\nVocê já tinha um PIX pendente para este produto — aqui está ele de novo. Escaneie o QR Code pelo app do seu banco ou copie o código. Ele expira ${ORDER_EXPIRATION_MINUTES} minutos após a criação do pedido.`
        : `**Pedido:** \`${order.id}\`\n**Valor:** R$ ${formatPrice(order.product.price)}\n\nEscaneie o QR Code abaixo pelo app do seu banco ou copie o código PIX. O bot avisará por DM quando o pagamento for aprovado. Este PIX expira em ${ORDER_EXPIRATION_MINUTES} minutos.`
    )
  );

  const files: AttachmentBuilder[] = [];

  if (pix.qrCodeBase64) {
    const attachment = new AttachmentBuilder(Buffer.from(pix.qrCodeBase64, 'base64'), { name: 'pix-qrcode.png' });
    files.push(attachment);
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://pix-qrcode.png').setDescription('QR Code do pagamento PIX')
      )
    );
  }

  if (pix.qrCode) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**PIX copia e cola:**\n\`\`\`\n${pix.qrCode}\n\`\`\``)
    );
  }

  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`check:${order.id}`).setLabel('Verificar pagamento').setStyle(ButtonStyle.Success)
    )
  );

  return {
    components: [container],
    files,
    flags: MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2
  };
}

export function buildCardPaymentReply(order: Order, checkoutUrl: string, reused = false) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 💳 Pagamento com cartão — ${order.product.name}`)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**Pedido:** \`${order.id}\`\n**Valor:** R$ ${formatPrice(order.product.price)}\n\n` +
        `${reused ? 'Você já tinha um pagamento em aberto para este produto — aqui está o link de novo.' : 'Clique no botão abaixo para pagar com cartão de crédito ou débito numa página segura do Mercado Pago.'} ` +
        `Seus dados de cartão nunca passam pelo Discord ou pelo bot.\n\n` +
        `⚠️ **Atualmente é necessário entrar ou criar uma conta Mercado Pago** para concluir o pagamento com cartão (é rápido e gratuito). O bot avisará por DM quando o pagamento for aprovado.`
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel('Abrir pagamento seguro').setStyle(ButtonStyle.Link).setURL(checkoutUrl)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`check:${order.id}`).setLabel('Verificar pagamento').setStyle(ButtonStyle.Success)
    )
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2 };
}
