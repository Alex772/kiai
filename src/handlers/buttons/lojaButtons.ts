import { ActionRowBuilder, ButtonInteraction, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { buildLojaReply } from '../../views/lojaView.js';

/** Retorna true se tratou a interação (customId reconhecido), false caso contrário. */
export async function handleLojaButtons(interaction: ButtonInteraction): Promise<boolean> {
  if (interaction.customId.startsWith('loja:page:')) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Esse comando só funciona dentro de um servidor.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const targetPage = Number(interaction.customId.split(':')[2]);
    await interaction.update(await buildLojaReply(interaction.guildId, targetPage));
    return true;
  }

  if (interaction.customId === 'loja:jump') {
    const modal = new ModalBuilder().setCustomId('loja:jumpmodal').setTitle('Ir para página');
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('pagina')
          .setLabel('Número da página')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(5)
      )
    );
    await interaction.showModal(modal);
    return true;
  }

  return false;
}
