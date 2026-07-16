import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  RoleSelectMenuBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ContainerBuilder
} from 'discord.js';
import { formatDuration } from '../duration.js';
import { formatPrice } from '../format.js';
import type { Product } from '../products.js';

export function buildEditProductOverviewReply(product: Product) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ✏️ Editando: ${product.name}\n` +
        `**Posição:** ${product.position}\n` +
        `**Preço:** R$ ${formatPrice(product.price)}\n` +
        `**Descrição:** ${product.description}\n` +
        `**Mensagem de entrega:** ${product.deliveryMessage}\n` +
        `**Cargo de entrega:** ${product.deliveryRoleId ? `<@&${product.deliveryRoleId}>` : 'Nenhum'}\n` +
        `**Duração do cargo:** ${product.deliveryRoleId ? (product.deliveryRoleDuration ? formatDuration(product.deliveryRoleDuration) : 'Permanente') : '—'}`
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`editarproduto:editbtn:${product.id}`)
        .setLabel('✏️ Editar nome/preço/descrição/entrega/posição')
        .setStyle(ButtonStyle.Primary)
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`editarproduto:role:${product.id}`)
        .setPlaceholder(product.deliveryRoleId ? 'Trocar cargo de entrega' : 'Escolher cargo de entrega (opcional)')
        .setMinValues(1)
        .setMaxValues(1)
    )
  );

  if (product.deliveryRoleId) {
    const roleButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`editarproduto:duration:${product.id}`)
        .setLabel('⏱️ Definir duração do cargo')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`editarproduto:clearrole:${product.id}`)
        .setLabel('🗑️ Remover cargo de entrega')
        .setStyle(ButtonStyle.Danger)
    );
    container.addActionRowComponents(roleButtons);
  }

  return { components: [container], flags: MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2 };
}
