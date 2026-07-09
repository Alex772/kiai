import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ComponentType,
  ContainerBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction
} from 'discord.js';
import { config, getMissingRequiredEnv } from './config.js';
import { toUserErrorMessage } from './errors.js';
import { createPixPayment, getPaymentStatus } from './mercadoPago.js';
import { addProduct, findProduct, products, removeProduct } from './products.js';
import { createOrder, getOrder, updateOrder } from './store.js';
import { registerSlashCommands } from './registerSlashCommands.js';
import { startHttpServer } from './server.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on(Events.Error, (error) => {
  console.error('Erro do cliente Discord:', error);
});

async function replyError(interaction: ChatInputCommandInteraction | ButtonInteraction, error: unknown) {
  const message = toUserErrorMessage(error);
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, components: [] });
      return;
    }
    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error('Falha ao enviar resposta de erro:', err);
  }
}

function isGuildOwner(interaction: ChatInputCommandInteraction): boolean {
  return interaction.guild?.ownerId === interaction.user.id;
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot conectado como ${readyClient.user.tag}`);
});

// Autocomplete
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isAutocomplete()) return;

  const focused = (interaction as AutocompleteInteraction).options.getFocused().toLowerCase();

  if (interaction.commandName === 'comprar' || interaction.commandName === 'removerproduto') {
    const choices = products
      .filter((p) => p.name.toLowerCase().includes(focused) || p.id.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((p) => ({ name: `${p.name} — R$ ${p.price.toFixed(2)}`, value: p.id }));

    await interaction.respond(choices);
  }
});

// Slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // /loja
    if (interaction.commandName === 'loja') {
      const container = new ContainerBuilder();

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## 🛒 Loja\nUse `/comprar` para gerar um PIX pelo Mercado Pago.')
      );
      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

      if (products.length === 0) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('Nenhum produto disponível no momento.'));
      } else {
        for (const product of products) {
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `### ${product.name} — R$ ${product.price.toFixed(2)}\n${product.description}`
            )
          );
        }
      }

      await interaction.reply({
        components: [container],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
      });
      return;
    }

    // /comprar
    if (interaction.commandName === 'comprar') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const productId = interaction.options.getString('produto', true);
      const product = findProduct(productId);

      if (!product) {
        await interaction.editReply('Produto não encontrado.');
        return;
      }

      const order = createOrder({ id: randomUUID(), userId: interaction.user.id, product });
      const pix = await createPixPayment(order);
      updateOrder(order.id, { paymentId: pix.paymentId, qrCode: pix.qrCode, qrCodeBase64: pix.qrCodeBase64 });

      if (!pix.paymentId || !pix.qrCode) {
        await interaction.editReply('Não foi possível gerar o PIX. Tente novamente em alguns minutos.');
        return;
      }

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## 💸 Pagamento PIX — ${product.name}`)
      );
      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**Pedido:** \`${order.id}\`\n**Valor:** R$ ${product.price.toFixed(2)}\n\nCopie o código PIX abaixo no app do seu banco. O bot avisará por DM quando o pagamento for aprovado.`
        )
      );
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**PIX copia e cola:**\n\`\`\`\n${pix.qrCode}\n\`\`\``)
      );
      container.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`check:${order.id}`).setLabel('Verificar pagamento').setStyle(ButtonStyle.Success)
        )
      );

      await interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
      return;
    }

    // /pedido
    if (interaction.commandName === 'pedido') {
      const orderId = interaction.options.getString('id', true);
      const order = getOrder(orderId);

      if (!order || order.userId !== interaction.user.id) {
        await interaction.reply({ content: 'Pedido não encontrado para sua conta.', flags: MessageFlags.Ephemeral });
        return;
      }

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## 📦 Pedido\n**ID:** \`${order.id}\`\n**Produto:** ${order.product.name}\n**Status:** ${order.status}\n**Criado em:** ${new Date(order.createdAt).toLocaleString('pt-BR')}`
        )
      );

      await interaction.reply({
        components: [container],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
      });
      return;
    }

    // /addproduto
    if (interaction.commandName === 'addproduto') {
      if (!isGuildOwner(interaction)) {
        await interaction.reply({ content: 'Apenas o dono do servidor pode usar este comando.', flags: MessageFlags.Ephemeral });
        return;
      }

      const id = interaction.options.getString('id', true).trim().replace(/\s+/g, '_');
      const name = interaction.options.getString('nome', true);
      const price = interaction.options.getNumber('preco', true);
      const description = interaction.options.getString('descricao', true);
      const deliveryMessage = interaction.options.getString('entrega', true);

      if (findProduct(id)) {
        await interaction.reply({ content: `Já existe um produto com o ID \`${id}\`.`, flags: MessageFlags.Ephemeral });
        return;
      }

      addProduct({ id, name, price, description, deliveryMessage });

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ✅ Produto adicionado\n**ID:** \`${id}\`\n**Nome:** ${name}\n**Preço:** R$ ${price.toFixed(2)}\n**Descrição:** ${description}`
        )
      );

      await interaction.reply({
        components: [container],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
      });
      return;
    }

    // /removerproduto
    if (interaction.commandName === 'removerproduto') {
      if (!isGuildOwner(interaction)) {
        await interaction.reply({ content: 'Apenas o dono do servidor pode usar este comando.', flags: MessageFlags.Ephemeral });
        return;
      }

      const productId = interaction.options.getString('produto', true);
      const product = findProduct(productId);

      if (!product) {
        await interaction.reply({ content: 'Produto não encontrado.', flags: MessageFlags.Ephemeral });
        return;
      }

      removeProduct(productId);

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## 🗑️ Produto removido\n**${product.name}** foi removido da loja.`)
      );

      await interaction.reply({
        components: [container],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
      });
      return;
    }
  } catch (error) {
    console.error('Erro ao processar comando slash:', error);
    await replyError(interaction, error);
  }
});

// Button: verificar pagamento
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

    const container = new ContainerBuilder();

    if (status === 'approved') {
      updateOrder(order.id, { status: 'approved' });
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ✅ Pagamento aprovado!\n${order.product.deliveryMessage}`)
      );
    } else {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ⏳ Pagamento pendente\nStatus atual no Mercado Pago: **${status ?? 'desconhecido'}**`
        )
      );
    }

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
  } catch (error) {
    console.error('Erro ao processar botão de pagamento:', error);
    await replyError(interaction, error);
  }
});

startHttpServer(client, () => ({
  discordReady: client.isReady(),
  missingEnv: getMissingRequiredEnv()
}));

const missingEnv = getMissingRequiredEnv();

if (missingEnv.length > 0) {
  console.error(`Bot iniciado em modo de configuração incompleta. Defina as variáveis no Railway: ${missingEnv.join(', ')}`);
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
