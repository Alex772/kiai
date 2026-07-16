import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { findProduct } from '../../products.js';
import { buildLojaReply } from '../../views/lojaView.js';
import { buildPaymentMethodChoiceReply } from '../../views/paymentViews.js';

export async function handleLoja(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.guildId) {
    await interaction.editReply('Esse comando só funciona dentro de um servidor.');
    return;
  }

  await interaction.editReply(await buildLojaReply(interaction.guildId, 1));
}

export async function handleComprar(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.guildId) {
    await interaction.editReply('Esse comando só funciona dentro de um servidor.');
    return;
  }

  const productId = Number(interaction.options.getString('produto', true));
  const product = await findProduct(interaction.guildId, productId);

  if (!product) {
    await interaction.editReply('Produto não encontrado.');
    return;
  }

  await interaction.editReply(buildPaymentMethodChoiceReply(product));
}
