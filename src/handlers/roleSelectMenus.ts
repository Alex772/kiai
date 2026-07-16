import { Events, MessageFlags } from 'discord.js';
import { client } from '../client.js';
import { toUserErrorMessage } from '../errors.js';
import { logAdmin, LOG_COLOR } from '../logging.js';
import { findProduct, setProductDeliveryRole } from '../products.js';
import { buildEditProductOverviewReply } from '../views/editProductView.js';

// Menus de seleção de cargo (RoleSelectMenu)
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isRoleSelectMenu()) return;

  try {
    if (interaction.customId.startsWith('editarproduto:role:')) {
      if (!interaction.guildId) {
        await interaction.reply({ content: 'Esse comando só funciona dentro de um servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      const productId = Number(interaction.customId.split(':')[2]);
      const roleId = interaction.values[0];

      const before = await findProduct(interaction.guildId, productId);
      const updated = await setProductDeliveryRole(interaction.guildId, productId, roleId);

      if (!updated) {
        await interaction.reply({ content: 'Produto não encontrado (pode ter sido removido).', flags: MessageFlags.Ephemeral });
        return;
      }

      await logAdmin(client, interaction.guildId, {
        actor: interaction.user,
        title: '🎭 Cargo de entrega alterado',
        description:
          `**Produto:** ${updated.name} (\`${updated.id}\`)\n` +
          `**Antes:** ${before?.deliveryRoleId ? `<@&${before.deliveryRoleId}>` : 'Nenhum'}\n` +
          `**Agora:** <@&${roleId}>`,
        color: LOG_COLOR.edited
      });

      await interaction.update(buildEditProductOverviewReply(updated));
    }
  } catch (error) {
    console.error('Erro ao processar seleção de cargo:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: toUserErrorMessage(error), flags: MessageFlags.Ephemeral });
    }
  }
});
