import { Events, MessageFlags } from 'discord.js';
import { client } from '../client.js';
import { formatDuration, parseDuration } from '../duration.js';
import { toUserErrorMessage } from '../errors.js';
import { formatPrice, parsePrice } from '../format.js';
import { diffFields, logAdmin, LOG_COLOR } from '../logging.js';
import { editProduct, findProduct, setProductDeliveryRoleDuration } from '../products.js';
import { buildEditProductOverviewReply } from '../views/editProductView.js';
import { buildLojaReply } from '../views/lojaView.js';

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isModalSubmit()) return;

  try {
    if (interaction.customId.startsWith('editarproduto:modal:')) {
      if (!interaction.guildId) {
        await interaction.reply({ content: 'Esse comando só funciona dentro de um servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      const productId = Number(interaction.customId.split(':')[2]);
      const before = await findProduct(interaction.guildId, productId);

      const name = interaction.fields.getTextInputValue('nome').trim();
      const priceRaw = interaction.fields.getTextInputValue('preco').trim();
      const description = interaction.fields.getTextInputValue('descricao').trim();
      const deliveryMessage = interaction.fields.getTextInputValue('entrega').trim();
      const positionRaw = interaction.fields.getTextInputValue('posicao').trim();

      const price = parsePrice(priceRaw);
      if (price === undefined || price <= 0) {
        await interaction.reply({ content: 'Preço inválido. Use um valor como `9,90`.', flags: MessageFlags.Ephemeral });
        return;
      }

      const position = Number(positionRaw);
      if (!Number.isInteger(position) || position < 1) {
        await interaction.reply({ content: 'Posição inválida. Use um número inteiro a partir de 1.', flags: MessageFlags.Ephemeral });
        return;
      }

      const updated = await editProduct(interaction.guildId, productId, { name, price, description, deliveryMessage, position });

      if (!updated) {
        await interaction.reply({ content: 'Produto não encontrado (pode ter sido removido).', flags: MessageFlags.Ephemeral });
        return;
      }

      if (before) {
        await logAdmin(client, interaction.guildId, {
          actor: interaction.user,
          title: '✏️ Produto editado',
          description:
            `**Produto:** ${updated.name} (\`${updated.id}\`)\n` +
            diffFields(
              {
                Nome: before.name,
                Preço: `R$ ${formatPrice(before.price)}`,
                Descrição: before.description,
                'Mensagem de entrega': before.deliveryMessage,
                Posição: String(before.position)
              },
              {
                Nome: updated.name,
                Preço: `R$ ${formatPrice(updated.price)}`,
                Descrição: updated.description,
                'Mensagem de entrega': updated.deliveryMessage,
                Posição: String(updated.position)
              }
            ),
          color: LOG_COLOR.edited
        });
      }

      if (interaction.isFromMessage()) {
        await interaction.update(buildEditProductOverviewReply(updated));
      } else {
        await interaction.reply({ components: buildEditProductOverviewReply(updated).components, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      }
      return;
    }

    if (interaction.customId.startsWith('editarproduto:durationmodal:')) {
      if (!interaction.guildId) {
        await interaction.reply({ content: 'Esse comando só funciona dentro de um servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      const productId = Number(interaction.customId.split(':')[2]);
      const before = await findProduct(interaction.guildId, productId);
      const raw = interaction.fields.getTextInputValue('duracao').trim();

      const duration = raw ? parseDuration(raw) : undefined;

      if (raw && !duration) {
        await interaction.reply({
          content: 'Duração inválida. Use um formato como `30 dias`, `1 mes`, `1 ano`, `12 horas`, ou deixe vazio para permanente.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const updated = await setProductDeliveryRoleDuration(interaction.guildId, productId, duration ?? null);

      if (!updated) {
        await interaction.reply({ content: 'Produto não encontrado (pode ter sido removido).', flags: MessageFlags.Ephemeral });
        return;
      }

      await logAdmin(client, interaction.guildId, {
        actor: interaction.user,
        title: '⏱️ Duração do cargo de entrega alterada',
        description:
          `**Produto:** ${updated.name} (\`${updated.id}\`)\n` +
          `**Antes:** ${before?.deliveryRoleDuration ? formatDuration(before.deliveryRoleDuration) : 'Permanente'}\n` +
          `**Agora:** ${duration ? formatDuration(duration) : 'Permanente'}`,
        color: LOG_COLOR.edited
      });

      if (interaction.isFromMessage()) {
        await interaction.update(buildEditProductOverviewReply(updated));
      } else {
        await interaction.reply({ components: buildEditProductOverviewReply(updated).components, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      }
      return;
    }

    if (interaction.customId === 'loja:jumpmodal') {
      const raw = interaction.fields.getTextInputValue('pagina').trim();
      const page = Number(raw);
      const targetPage = Number.isInteger(page) && page > 0 ? page : 1;

      if (interaction.isFromMessage() && interaction.guildId) {
        await interaction.update(await buildLojaReply(interaction.guildId, targetPage));
      } else {
        await interaction.reply({ content: 'Não foi possível atualizar a página.', flags: MessageFlags.Ephemeral });
      }
    }
  } catch (error) {
    console.error('Erro ao processar modal:', error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: toUserErrorMessage(error), components: [] });
    } else if (!interaction.replied) {
      await interaction.reply({ content: toUserErrorMessage(error), flags: MessageFlags.Ephemeral });
    }
  }
});
