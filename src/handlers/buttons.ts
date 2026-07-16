import { Events } from 'discord.js';
import { client } from '../client.js';
import { replyError } from '../permissions.js';
import { handleEditProductButtons } from './buttons/editProductButtons.js';
import { handleLojaButtons } from './buttons/lojaButtons.js';
import { handlePaymentButtons } from './buttons/paymentButtons.js';

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  try {
    if (await handleEditProductButtons(interaction)) return;
    if (await handleLojaButtons(interaction)) return;
    if (await handlePaymentButtons(interaction)) return;
  } catch (error) {
    console.error('Erro ao processar botão:', error);
    await replyError(interaction, error);
  }
});
