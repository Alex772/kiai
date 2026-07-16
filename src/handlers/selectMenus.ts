import { Events, MessageFlags } from 'discord.js';
import { client } from '../client.js';
import { toUserErrorMessage } from '../errors.js';
import { findProduct } from '../products.js';
import { buildEditProductOverviewReply } from '../views/editProductView.js';

// Menus de seleção (StringSelectMenu)
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;

  try {
    if (interaction.customId === 'editarproduto:select') {
      if (!interaction.guildId) {
        await interaction.reply({ content: 'Esse comando só funciona dentro de um servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      const productId = Number(interaction.values[0]);
      const product = await findProduct(interaction.guildId, productId);

      if (!product) {
        await interaction.reply({ content: 'Produto não encontrado (pode ter sido removido).', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.update(buildEditProductOverviewReply(product));
    }
  } catch (error) {
    console.error('Erro ao processar menu de seleção:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: toUserErrorMessage(error), flags: MessageFlags.Ephemeral });
    }
  }
});
