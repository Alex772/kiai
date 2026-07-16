import {
  ActionRowBuilder,
  ButtonInteraction,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { client } from '../../client.js';
import { formatDuration } from '../../duration.js';
import { formatPrice } from '../../format.js';
import { logAdmin, LOG_COLOR } from '../../logging.js';
import { countProducts, findProduct, setProductDeliveryRole } from '../../products.js';
import { buildEditProductOverviewReply } from '../../views/editProductView.js';

/** Retorna true se tratou a interação (customId reconhecido), false caso contrário. */
export async function handleEditProductButtons(interaction: ButtonInteraction): Promise<boolean> {
  if (interaction.customId.startsWith('editarproduto:editbtn:')) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Esse comando só funciona dentro de um servidor.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const productId = Number(interaction.customId.split(':')[2]);
    const product = await findProduct(interaction.guildId, productId);

    if (!product) {
      await interaction.reply({ content: 'Produto não encontrado (pode ter sido removido).', flags: MessageFlags.Ephemeral });
      return true;
    }

    const total = await countProducts(interaction.guildId);

    const modal = new ModalBuilder()
      .setCustomId(`editarproduto:modal:${productId}`)
      .setTitle(`Editar: ${product.name}`.slice(0, 45));

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('nome')
          .setLabel('Nome')
          .setStyle(TextInputStyle.Short)
          .setValue(product.name)
          .setRequired(true)
          .setMaxLength(100)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('preco')
          .setLabel('Preço (ex: 9,90)')
          .setStyle(TextInputStyle.Short)
          .setValue(formatPrice(product.price))
          .setRequired(true)
          .setMaxLength(20)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('descricao')
          .setLabel('Descrição')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(product.description)
          .setRequired(true)
          .setMaxLength(500)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('entrega')
          .setLabel('Mensagem de entrega')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(product.deliveryMessage)
          .setRequired(true)
          .setMaxLength(1000)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('posicao')
          .setLabel(`Posição (1 a ${total})`)
          .setStyle(TextInputStyle.Short)
          .setValue(String(product.position ?? 1))
          .setRequired(true)
          .setMaxLength(5)
      )
    );

    await interaction.showModal(modal);
    return true;
  }

  if (interaction.customId.startsWith('editarproduto:clearrole:')) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Esse comando só funciona dentro de um servidor.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const productId = Number(interaction.customId.split(':')[2]);
    const before = await findProduct(interaction.guildId, productId);
    const updated = await setProductDeliveryRole(interaction.guildId, productId, null);

    if (!updated) {
      await interaction.reply({ content: 'Produto não encontrado (pode ter sido removido).', flags: MessageFlags.Ephemeral });
      return true;
    }

    await logAdmin(client, interaction.guildId, {
      actor: interaction.user,
      title: '🎭 Cargo de entrega removido',
      description: `**Produto:** ${updated.name} (\`${updated.id}\`)\n**Cargo removido:** ${before?.deliveryRoleId ? `<@&${before.deliveryRoleId}>` : 'Nenhum'}`,
      color: LOG_COLOR.removed
    });

    await interaction.update(buildEditProductOverviewReply(updated));
    return true;
  }

  if (interaction.customId.startsWith('editarproduto:duration:')) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Esse comando só funciona dentro de um servidor.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const productId = Number(interaction.customId.split(':')[2]);
    const product = await findProduct(interaction.guildId, productId);

    if (!product) {
      await interaction.reply({ content: 'Produto não encontrado (pode ter sido removido).', flags: MessageFlags.Ephemeral });
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(`editarproduto:durationmodal:${productId}`)
      .setTitle('Duração do cargo de entrega');

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('duracao')
          .setLabel('Ex: 30 dias, 1 mes, 1 ano, 12 horas')
          .setStyle(TextInputStyle.Short)
          .setValue(product.deliveryRoleDuration ? formatDuration(product.deliveryRoleDuration) : '')
          .setPlaceholder('Deixe vazio para permanente')
          .setRequired(false)
          .setMaxLength(30)
      )
    );

    await interaction.showModal(modal);
    return true;
  }

  return false;
}
