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
  ModalBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ContainerBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction
} from 'discord.js';
import { config, getMissingRequiredEnv } from './config.js';
import { toUserErrorMessage } from './errors.js';
import { formatPrice, parsePrice } from './format.js';
import { createPixPayment, getPaymentStatus } from './mercadoPago.js';
import { addProduct, countProducts, editProduct, findProduct, listProducts, removeProduct, type Product } from './products.js';
import { getStoreSettings, updateStoreSettings } from './settings.js';
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
    `**Valor:** R$ ${formatPrice(order.product.price)}`,
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
      `**Pedido:** \`${order.id}\`\n**Valor:** R$ ${formatPrice(order.product.price)}\n\nEscaneie o QR Code abaixo pelo app do seu banco ou copie o código PIX. O bot avisará por DM quando o pagamento for aprovado.`
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

async function buildLojaReply(requestedPage: number) {
  const [products, settings] = await Promise.all([listProducts(), getStoreSettings()]);
  const perPage = Math.max(1, settings.itemsPerPage);
  const totalPages = Math.max(1, Math.ceil(products.length / perPage));
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  const start = (page - 1) * perPage;
  const pageProducts = products.slice(start, start + perPage);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${settings.title}\n${settings.description}`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  if (pageProducts.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('Nenhum produto disponível no momento.'));
  } else {
    for (const product of pageProducts) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ${product.name} — R$ ${formatPrice(product.price)}\n${product.description}`)
      );
      container.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`comprar:${product.id}`).setLabel(`Comprar ${product.name}`).setStyle(ButtonStyle.Primary)
        )
      );
    }
  }

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`loja:page:${page - 1}`).setLabel('◀ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
      new ButtonBuilder().setCustomId('loja:jump').setLabel(`Página ${page}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(totalPages <= 1),
      new ButtonBuilder().setCustomId(`loja:page:${page + 1}`).setLabel('Próxima ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages)
    )
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2 };
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

    if (['comprar', 'removerproduto'].includes(autocomplete.commandName)) {
      const products = await listProducts();
      const choices = products
        .filter((p) => p.name.toLowerCase().includes(focused) || String(p.id).includes(focused))
        .slice(0, 25)
        .map((p) => ({ name: `${p.name} — R$ ${formatPrice(p.price)}`, value: String(p.id) }));

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
      await interaction.editReply(await buildLojaReply(1));
      return;
    }

    // /comprar
    if (interaction.commandName === 'comprar') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const productId = Number(interaction.options.getString('produto', true));
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
              `**${order.product.name}** — R$ ${formatPrice(order.product.price)} — ${STATUS_LABEL[order.status]}\n\`${order.id}\` • ${formatDate(order.createdAt)}`
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

      const name = interaction.options.getString('nome', true);
      const priceRaw = interaction.options.getString('preco', true);
      const description = interaction.options.getString('descricao', true);
      const deliveryMessage = interaction.options.getString('entrega', true);
      const position = interaction.options.getInteger('posicao') ?? undefined;

      const price = parsePrice(priceRaw);

      if (price === undefined || price <= 0) {
        await interaction.editReply('Preço inválido. Use um valor como `9,90`.');
        return;
      }

      const product = await addProduct({ name, description, price, deliveryMessage, position });

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ✅ Produto adicionado\n**ID:** \`${product.id}\`\n**Posição:** ${product.position}\n**Nome:** ${product.name}\n**Preço:** R$ ${formatPrice(product.price)}\n**Descrição:** ${product.description}`
        )
      );

      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    // /editarproduto — mostra a lista de produtos com um menu para escolher qual editar
    if (interaction.commandName === 'editarproduto') {
      if (!isGuildOwner(interaction)) {
        await interaction.reply({ content: 'Apenas o dono do servidor pode usar este comando.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const products = await listProducts();

      if (products.length === 0) {
        await interaction.editReply('Não há produtos cadastrados ainda. Use `/addproduto` primeiro.');
        return;
      }

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## ✏️ Editar produto\nEscolha um produto abaixo para ver e editar todos os dados dele.')
      );
      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

      const select = new StringSelectMenuBuilder()
        .setCustomId('editarproduto:select')
        .setPlaceholder('Selecione um produto')
        .addOptions(
          products.slice(0, 25).map((p) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`${p.position}. ${p.name}`.slice(0, 100))
              .setDescription(`R$ ${formatPrice(p.price)}`.slice(0, 100))
              .setValue(String(p.id))
          )
        );

      container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));

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

      const productId = Number(interaction.options.getString('produto', true));
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

    // /lojaconfig
    if (interaction.commandName === 'lojaconfig') {
      if (!isGuildOwner(interaction)) {
        await interaction.reply({ content: 'Apenas o dono do servidor pode usar este comando.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const itemsPerPage = interaction.options.getInteger('itens_por_pagina') ?? undefined;
      const title = interaction.options.getString('titulo') ?? undefined;
      const description = interaction.options.getString('descricao') ?? undefined;

      if (itemsPerPage === undefined && title === undefined && description === undefined) {
        const current = await getStoreSettings();
        await interaction.editReply(
          `## ⚙️ Configuração atual da loja\n**Itens por página:** ${current.itemsPerPage}\n**Título:** ${current.title}\n**Descrição:** ${current.description}`
        );
        return;
      }

      const updated = await updateStoreSettings({ itemsPerPage, title, description });

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ✅ Configuração da loja atualizada\n**Itens por página:** ${updated.itemsPerPage}\n**Título:** ${updated.title}\n**Descrição:** ${updated.description}`
        )
      );

      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }
  } catch (error) {
    console.error('Erro ao processar comando slash:', error);
    await replyError(interaction, error);
  }
});

// Menus de seleção (StringSelectMenu)
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;

  try {
    if (interaction.customId === 'editarproduto:select') {
      const productId = Number(interaction.values[0]);
      const product = await findProduct(productId);

      if (!product) {
        await interaction.reply({ content: 'Produto não encontrado (pode ter sido removido).', flags: MessageFlags.Ephemeral });
        return;
      }

      const total = await countProducts();

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
    }
  } catch (error) {
    console.error('Erro ao processar menu de seleção:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: toUserErrorMessage(error), flags: MessageFlags.Ephemeral });
    }
  }
});

// Modais
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isModalSubmit()) return;

  try {
    if (interaction.customId.startsWith('editarproduto:modal:')) {
      const productId = Number(interaction.customId.split(':')[2]);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const name = interaction.fields.getTextInputValue('nome').trim();
      const priceRaw = interaction.fields.getTextInputValue('preco').trim();
      const description = interaction.fields.getTextInputValue('descricao').trim();
      const deliveryMessage = interaction.fields.getTextInputValue('entrega').trim();
      const positionRaw = interaction.fields.getTextInputValue('posicao').trim();

      const price = parsePrice(priceRaw);
      if (price === undefined || price <= 0) {
        await interaction.editReply('Preço inválido. Use um valor como `9,90`.');
        return;
      }

      const position = Number(positionRaw);
      if (!Number.isInteger(position) || position < 1) {
        await interaction.editReply('Posição inválida. Use um número inteiro a partir de 1.');
        return;
      }

      const updated = await editProduct(productId, { name, price, description, deliveryMessage, position });

      if (!updated) {
        await interaction.editReply('Produto não encontrado (pode ter sido removido).');
        return;
      }

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ✅ Produto atualizado\n**Posição:** ${updated.position}\n**Nome:** ${updated.name}\n**Preço:** R$ ${formatPrice(updated.price)}\n**Descrição:** ${updated.description}`
        )
      );

      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    if (interaction.customId === 'loja:jumpmodal') {
      const raw = interaction.fields.getTextInputValue('pagina').trim();
      const page = Number(raw);
      const targetPage = Number.isInteger(page) && page > 0 ? page : 1;

      if (interaction.isFromMessage()) {
        await interaction.update(await buildLojaReply(targetPage));
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

// Botões: navegação da loja, comprar direto da /loja e verificar pagamento
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  try {
    if (interaction.customId.startsWith('loja:page:')) {
      const targetPage = Number(interaction.customId.split(':')[2]);
      await interaction.update(await buildLojaReply(targetPage));
      return;
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
      return;
    }

    if (interaction.customId.startsWith('comprar:')) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const productId = Number(interaction.customId.replace('comprar:', ''));
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
