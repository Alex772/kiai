import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction
} from 'discord.js';
import { config, getMissingRequiredEnv } from './config.js';
import { createPixPayment, getPaymentStatus } from './mercadoPago.js';
import { findProduct, products } from './products.js';
import { createOrder, getOrder, updateOrder } from './store.js';
import { registerSlashCommands } from './registerSlashCommands.js';
import { startHttpServer } from './server.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on(Events.Error, (error) => {
  console.error('Erro do cliente Discord:', error);
});

async function replyWithInteractionError(interaction: ChatInputCommandInteraction | ButtonInteraction) {
  const message = 'Ocorreu um erro ao processar sua solicitação. Tente novamente em alguns minutos.';

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message);
      return;
    }

    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('Falha ao enviar resposta de erro para a interação:', error);
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot conectado como ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'loja') {
      const embed = new EmbedBuilder()
        .setTitle('Loja')
        .setDescription('Use `/comprar produto:<item>` para gerar um PIX pelo Mercado Pago.')
        .setColor(0x00aaff)
        .addFields(
          products.map((product) => ({
            name: `${product.name} — R$ ${product.price.toFixed(2)}`,
            value: product.description
          }))
        );

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.commandName === 'comprar') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const productId = interaction.options.getString('produto', true);
      const product = findProduct(productId);

      if (!product) {
        await interaction.editReply('Produto não encontrado.');
        return;
      }

      const order = createOrder({
        id: randomUUID(),
        userId: interaction.user.id,
        product
      });

      const pix = await createPixPayment(order);
      updateOrder(order.id, { paymentId: pix.paymentId, qrCode: pix.qrCode, qrCodeBase64: pix.qrCodeBase64 });

      if (!pix.paymentId || !pix.qrCode) {
        await interaction.editReply('Não foi possível gerar o PIX. Tente novamente em alguns minutos.');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`Pagamento PIX - ${product.name}`)
        .setDescription('Copie o código PIX abaixo no app do seu banco. O bot avisará por DM quando o Mercado Pago aprovar o pagamento.')
        .setColor(0x00cc66)
        .addFields(
          { name: 'Pedido', value: order.id },
          { name: 'Valor', value: `R$ ${product.price.toFixed(2)}` },
          { name: 'PIX copia e cola', value: `\`\`\`${pix.qrCode}\`\`\`` }
        );

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`check:${order.id}`).setLabel('Verificar pagamento').setStyle(ButtonStyle.Success)
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
      return;
    }

    if (interaction.commandName === 'pedido') {
      const orderId = interaction.options.getString('id', true);
      const order = getOrder(orderId);

      if (!order || order.userId !== interaction.user.id) {
        await interaction.reply({ content: 'Pedido não encontrado para sua conta.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({
        content: `Pedido **${order.id}**: ${order.status} — ${order.product.name}`,
        flags: MessageFlags.Ephemeral
      });
    }
  } catch (error) {
    console.error('Erro ao processar comando slash:', error);
    await replyWithInteractionError(interaction);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton() || !interaction.customId.startsWith('check:')) return;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const orderId = interaction.customId.replace('check:', '');
    const order = getOrder(orderId);

    if (!order || order.userId !== interaction.user.id || !order.paymentId) {
      await interaction.editReply('Pedido não encontrado para sua conta.');
      return;
    }

    const status = await getPaymentStatus(order.paymentId);
    if (status === 'approved') {
      updateOrder(order.id, { status: 'approved' });
      await interaction.editReply(`Pagamento aprovado! ${order.product.deliveryMessage}`);
      return;
    }

    await interaction.editReply(`Pagamento ainda não aprovado. Status atual no Mercado Pago: ${status ?? 'desconhecido'}.`);
  } catch (error) {
    console.error('Erro ao processar botão de pagamento:', error);
    await replyWithInteractionError(interaction);
  }
});

startHttpServer(client, () => ({
  discordReady: client.isReady(),
  missingEnv: getMissingRequiredEnv()
}));

const missingEnv = getMissingRequiredEnv();

if (missingEnv.length > 0) {
  console.error(
    `Bot iniciado em modo de configuração incompleta. Defina as variáveis no Railway: ${missingEnv.join(', ')}`
  );
} else {
  if (config.autoRegisterCommands) {
    try {
      const result = await registerSlashCommands();
      console.log(`Registrados ${result.count} comandos slash automaticamente no escopo ${result.scope}.`);
    } catch (error) {
      console.error('Falha ao registrar comandos slash automaticamente:', error);
    }
  }

  await client.login(config.discordToken);
}
