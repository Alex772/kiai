import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ContainerBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction
} from 'discord.js';
import { config, getMissingRequiredEnv } from './config.js';
import { toUserErrorMessage } from './errors.js';
import { createPixPayment, getPaymentStatus } from './mercadoPago.js';
import { addProduct, editProduct, findProduct, listProducts, removeProduct, type Product } from './products.js';
import { createOrder, getOrder, listOrdersByUser, updateOrder, type Order } from './store.js';
import { registerSlashCommands } from './registerSlashCommands.js';
import { startHttpServer } from './server.js';
import { migrate } from './db.js';

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
  if (interaction.guild?.ownerId === interaction.user.id) return true;
  if (config.adminRoleId && interaction.inCachedGuild()) {
    return interaction.member.roles.cache.has(config.adminRoleId);
  }
  return false;
}

const STATUS_LABEL: Record<Order['status'], string> = {
  pending: '⏳ Pendente',
  approved: '✅ Aprovado',
  rejected: '❌ Rejeitado',
  cancelled: '🚫 Cancelado'
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function orderDetailContent(order: Order) {
  const lines = [
    `## 📦 Pedido`,
    `**ID:** \`${order.id}\``,
    `**Produto:** ${order.product.name}`,
    `**Valor:** R$ ${order.product.price.toFixed(2)}`,
    `**Status:** ${STATUS_LABEL[order.status]}`,
    order.paymentId ? `**ID do pagamento (Mercado Pago):** \`${order.paymentId}\`` : undefined,
    `**Criado em:** ${formatDate(order.createdAt)}`,
    `**Última atualização:** ${formatDate(order.updatedAt)}`
  ].filter(Boolean);

  return lines.join('\n');
}

async function buildPixOrder(userId: string, product: Product) {
  const order = await createOrder({ id: randomUUID(), userId, product });
  const pix = await createPixPayment(order);
  const updated = await updateOrder(order.id, {
    paymentId: pix.paymentId,
    qrCode: pix.qrCode,
    qrCodeBase64: pix.qrCodeBase64
  });
  return { order: updated ?? order, pix };
}

function buildPixPaymentReply(order: Order, pix: { qrCode?: string; qrCodeBase64?: string }) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 💸 Pagamento PIX — ${order.product.name}`)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**Pedido:** \`${order.id}\`\n**Valor:** R$ ${order.product.price.toFixed(2)}\n\nEscaneie o QR Code abaixo pelo app do seu banco ou copie o código PIX. O bot avisará por DM quando o pagamento for aprovado.`
    )
  );

  const files: AttachmentBuilder[] = [];

  if (pix.qrCodeBase64) {
    const attachment = new AttachmentBuilder(Buffer.from(pix.qrCodeBase64, 'base64'), { name: 'pix-qrcode.png' });
    files.push(attachment);
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://pix-qrcode.png').setDescription('QR Code do pagamento PIX')
      )
    );
  }

  if (pix.qrCode) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**PIX copia e cola:**\n\`\`\`\n${pix.qrCode}\n\`\`\``)
    );
  }

  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`check:${order.id}`).setLabel('Verificar pagamento').setStyle(ButtonStyle.Success)
    )
  );

  return {
    components: [container],
    files,
    flags: MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2
  };
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot conectado como ${readyClient.user.tag}`);
});

// Autocomplete
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isAutocomplete()) return;

  try {
    const autocomplete = interaction as AutocompleteInteraction;
    const focused = autocomplete.options.getFocused().toLowerCase();

    if (['comprar', 'removerproduto', 'editarproduto'].includes(autocomplete.commandName)) {
      const products = await listProducts();
      const choices = products
        .filter((p) => p.name.toLowerCase().includes(focused) || p.id.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((p) => ({ name: `${p.name} — R$ ${p.price.toFixed(2)}`, value: p.id }));

      await autocomplete.respond(choices);
      return;
    }

    if (autocomplete.commandName === 'pedido') {
      const orders = await listOrdersByUser(autocomplete.user.id, 25);
      const choices = orders
        .filter((o) => o.id.includes(focused) || o.product.name.toLowerCase().includes(focused))
        .map((o) => ({
          name: `${o.product.name} — ${STATUS_LABEL[o.status]} — ${o.id.slice(0, 8)}`,
          value: o.id
        }));

      await autocomplete.respond(choices);
    }
  } catch (error) {
    console.error('Erro no autocomplete:', error);
  }
});

// Slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // /loja
    if (interaction.commandName === 'loja') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const products = await listProducts();

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## 🛒 Loja\nUse `/comprar` ou clique em um botão abaixo para gerar um PIX pelo Mercado Pago.')
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
          container.addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder().setCustomId(`comprar:${product.id}`).setLabel(`Comprar ${product.name}`).setStyle(ButtonStyle.Primary)
            )
          );
        }
      }

      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    // /comprar
    if (interaction.commandName === 'comprar') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const productId = interaction.options.getString('produto', true);
      const product = await findProduct(productId);

      if (!product) {
        await interaction.editReply('Produto não encontrado.');
        return;
      }

      const { order, pix } = await buildPixOrder(interaction.user.id, product);

      if (!pix.paymentId || !pix.qrCode) {
        await interaction.editReply('Não foi possível gerar o PIX. Tente novamente em alguns minutos.');
        return;
      }

      await interaction.editReply(buildPixPaymentReply(order, pix));
      return;
    }

    // /pedido
    if (interaction.commandName === 'pedido') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const orderId = interaction.options.getString('id', true);
      const order = await getOrder(orderId);

      if (!order || order.userId !== interaction.user.id) {
        await interaction.editReply('Pedido não encontrado para sua conta.');
        return;
      }

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(orderDetailContent(order)));

      if (order.status === 'pending' && order.paymentId) {
        container.addActionRowComponents(
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`check:${order.id}`).setLabel('Verificar pagamento').setStyle(ButtonStyle.Success)
          )
        );
      }

      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    // /pedidos
    if (interaction.commandName === 'pedidos') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const orders = await listOrdersByUser(interaction.user.id, 10);

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## 📜 Seus últimos pedidos'));
      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

      if (orders.length === 0) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('Você ainda não fez nenhum pedido.'));
      } else {
        for (const order of orders) {
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `**${order.product.name}** — R$ ${order.product.price.toFixed(2)} — ${STATUS_LABEL[order.status]}\n\`${order.id}\` • ${formatDate(order.createdAt)}`
            )
          );
        }
      }

      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    // /addproduto
    if (interaction.commandName === 'addproduto') {
      if (!isGuildOwner(interaction)) {
        await interaction.reply({ content: 'Apenas o dono do servidor pode usar este comando.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const id = interaction.options.getString('id', true).trim().replace(/\s+/g, '_');
      const name = interaction.options.getString('nome', true);
      const price = interaction.options.getNumber('preco', true);
      const description = interaction.options.getString('descricao', true);
      const deliveryMessage = interaction.options.getString('entrega', true);

      if (price <= 0) {
        await interaction.editReply('O preço precisa ser maior que zero.');
        return;
      }

      if (await findProduct(id)) {
        await interaction.editReply(`Já existe um produto com o ID \`${id}\`.`);
        return;
      }

      await addProduct({ id, name, price, description, deliveryMessage });

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ✅ Produto adicionado\n**ID:** \`${id}\`\n**Nome:** ${name}\n**Preço:** R$ ${price.toFixed(2)}\n**Descrição:** ${description}`
        )
      );

      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    // /editarproduto
    if (interaction.commandName === 'editarproduto') {
      if (!isGuildOwner(interaction)) {
        await interaction.reply({ content: 'Apenas o dono do servidor pode usar este comando.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const productId = interaction.options.getString('produto', true);
      const name = interaction.options.getString('nome') ?? undefined;
      const price = interaction.options.getNumber('preco') ?? undefined;
      const description = interaction.options.getString('descricao') ?? undefined;
      const deliveryMessage = interaction.options.getString('entrega') ?? undefined;

      if (!name && price === undefined && !description && !deliveryMessage) {
        await interaction.editReply('Informe ao menos um campo para editar (nome, preco, descricao ou entrega).');
        return;
      }

      if (price !== undefined && price <= 0) {
        await interaction.editReply('O preço precisa ser maior que zero.');
        return;
      }

      const updated = await editProduct(productId, { name, price, description, deliveryMessage });

      if (!updated) {
        await interaction.editReply('Produto não encontrado.');
        return;
      }

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ✏️ Produto atualizado\n**ID:** \`${updated.id}\`\n**Nome:** ${updated.name}\n**Preço:** R$ ${updated.price.toFixed(2)}\n**Descrição:** ${updated.description}`
        )
      );

      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    // /removerproduto
    if (interaction.commandName === 'removerproduto') {
      if (!isGuildOwner(interaction)) {
        await interaction.reply({ content: 'Apenas o dono do servidor pode usar este comando.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const productId = interaction.options.getString('produto', true);
      const product = await findProduct(productId);

      if (!product) {
        await interaction.editReply('Produto não encontrado.');
        return;
      }

      await removeProduct(productId);

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## 🗑️ Produto removido\n**${product.name}** foi removido da loja.`)
      );

      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
  } catch (error) {
    console.error('Erro ao processar comando slash:', error);
    await replyError(interaction, error);
  }
});

// Botões: comprar direto da /loja e verificar pagamento
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  try {
    if (interaction.customId.startsWith('comprar:')) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const productId = interaction.customId.replace('comprar:', '');
      const product = await findProduct(productId);

      if (!product) {
        await interaction.editReply('Produto não encontrado (pode ter sido removido).');
        return;
      }

      const { order, pix } = await buildPixOrder(interaction.user.id, product);

      if (!pix.paymentId || !pix.qrCode) {
        await interaction.editReply('Não foi possível gerar o PIX. Tente novamente em alguns minutos.');
        return;
      }

      await interaction.editReply(buildPixPaymentReply(order, pix));
      return;
    }

    if (interaction.customId.startsWith('check:')) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const orderId = interaction.customId.replace('check:', '');
      const order = await getOrder(orderId);

      if (!order || order.userId !== interaction.user.id || !order.paymentId) {
        await interaction.editReply('Pedido não encontrado para sua conta.');
        return;
      }

      const status = await getPaymentStatus(order.paymentId);
      const container = new ContainerBuilder();

      if (status === 'approved') {
        await updateOrder(order.id, { status: 'approved' });
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

      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
  } catch (error) {
    console.error('Erro ao processar botão:', error);
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
  try {
    await migrate();
    console.log('Banco de dados PostgreSQL pronto (tabelas verificadas/criadas).');
  } catch (error) {
    console.error('Falha ao conectar/migrar o banco de dados PostgreSQL. Verifique DATABASE_URL/DATABASE_PUBLIC_URL:', error);
  }

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
