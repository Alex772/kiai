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
  RoleSelectMenuBuilder,
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
import { deliverOrder } from './delivery.js';
import { toUserErrorMessage } from './errors.js';
import { formatPrice, parsePrice } from './format.js';
import { createPixPayment, getPaymentStatus } from './mercadoPago.js';
import {
  addProduct,
  countProducts,
  editProduct,
  findProduct,
  listProducts,
  removeProduct,
  setProductDeliveryRole,
  type Product
} from './products.js';
import { getStoreSettings, updateStoreSettings } from './settings.js';
import {
  createOrder,
  findRecentPendingOrder,
  cancelExpiredOrders,
  getOrder,
  listOrdersByUser,
  updateOrder,
  ORDER_EXPIRATION_MINUTES,
  type Order
} from './store.js';
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

/** Acesso total: dono do servidor, cargo legado ADMIN_ROLE_ID (env) ou cargo admin configurado via /permissoes. */
async function isStoreAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (isGuildOwner(interaction)) return true;
  if (!interaction.inCachedGuild()) return false;

  const settings = await getStoreSettings();
  return settings.adminRoleId ? interaction.member.roles.cache.has(settings.adminRoleId) : false;
}

/** Acesso limitado (gerenciar produtos): tudo que isStoreAdmin cobre, mais o cargo moderador configurado. */
async function isStoreModerator(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (await isStoreAdmin(interaction)) return true;
  if (!interaction.inCachedGuild()) return false;

  const settings = await getStoreSettings();
  return settings.moderatorRoleId ? interaction.member.roles.cache.has(settings.moderatorRoleId) : false;
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
    order.product.deliveryRoleId ? `**Cargo de entrega:** <@&${order.product.deliveryRoleId}>` : undefined,
    order.paymentId ? `**ID do pagamento (Mercado Pago):** \`${order.paymentId}\`` : undefined,
    `**Criado em:** ${formatDate(order.createdAt)}`,
    `**Última atualização:** ${formatDate(order.updatedAt)}`
  ].filter(Boolean);

  return lines.join('\n');
}

async function buildPixOrder(userId: string, guildId: string | undefined, product: Product) {
  const existing = await findRecentPendingOrder(userId, product.id);

  if (existing && existing.paymentId && existing.qrCode) {
    return {
      order: existing,
      pix: { paymentId: existing.paymentId, qrCode: existing.qrCode, qrCodeBase64: existing.qrCodeBase64 },
      reused: true
    };
  }

  const order = await createOrder({ id: randomUUID(), userId, guildId, product });
  const pix = await createPixPayment(order);
  const updated = await updateOrder(order.id, {
    paymentId: pix.paymentId,
    qrCode: pix.qrCode,
    qrCodeBase64: pix.qrCodeBase64
  });
  return { order: updated ?? order, pix, reused: false };
}

function buildPixPaymentReply(order: Order, pix: { qrCode?: string; qrCodeBase64?: string }, reused = false) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 💸 Pagamento PIX — ${order.product.name}`)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      reused
        ? `**Pedido:** \`${order.id}\`\n**Valor:** R$ ${formatPrice(order.product.price)}\n\nVocê já tinha um PIX pendente para este produto — aqui está ele de novo. Escaneie o QR Code pelo app do seu banco ou copie o código. Ele expira ${ORDER_EXPIRATION_MINUTES} minutos após a criação do pedido.`
        : `**Pedido:** \`${order.id}\`\n**Valor:** R$ ${formatPrice(order.product.price)}\n\nEscaneie o QR Code abaixo pelo app do seu banco ou copie o código PIX. O bot avisará por DM quando o pagamento for aprovado. Este PIX expira em ${ORDER_EXPIRATION_MINUTES} minutos.`
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

function buildEditProductOverviewReply(product: Product) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ✏️ Editando: ${product.name}\n` +
        `**Posição:** ${product.position}\n` +
        `**Preço:** R$ ${formatPrice(product.price)}\n` +
        `**Descrição:** ${product.description}\n` +
        `**Mensagem de entrega:** ${product.deliveryMessage}\n` +
        `**Cargo de entrega:** ${product.deliveryRoleId ? `<@&${product.deliveryRoleId}>` : 'Nenhum'}`
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`editarproduto:editbtn:${product.id}`)
        .setLabel('✏️ Editar nome/preço/descrição/entrega/posição')
        .setStyle(ButtonStyle.Primary)
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`editarproduto:role:${product.id}`)
        .setPlaceholder(product.deliveryRoleId ? 'Trocar cargo de entrega' : 'Escolher cargo de entrega (opcional)')
        .setMinValues(1)
        .setMaxValues(1)
    )
  );

  if (product.deliveryRoleId) {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`editarproduto:clearrole:${product.id}`)
          .setLabel('🗑️ Remover cargo de entrega')
          .setStyle(ButtonStyle.Danger)
      )
    );
  }

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

      const { order, pix, reused } = await buildPixOrder(interaction.user.id, interaction.guildId ?? undefined, product);

      if (!pix.paymentId || !pix.qrCode) {
        await interaction.editReply('Não foi possível gerar o PIX. Tente novamente em alguns minutos.');
        return;
      }

      await interaction.editReply(buildPixPaymentReply(order, pix, reused));
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

      if ((order.status === 'pending' || order.status === 'cancelled') && order.paymentId) {
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
      if (!(await isStoreModerator(interaction))) {
        await interaction.reply({ content: 'Você não tem permissão para gerenciar produtos da loja.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const name = interaction.options.getString('nome', true);
      const priceRaw = interaction.options.getString('preco', true);
      const description = interaction.options.getString('descricao', true);
      const deliveryMessage = interaction.options.getString('entrega', true);
      const deliveryRole = interaction.options.getRole('cargo') ?? undefined;
      const position = interaction.options.getInteger('posicao') ?? undefined;

      const price = parsePrice(priceRaw);

      if (price === undefined || price <= 0) {
        await interaction.editReply('Preço inválido. Use um valor como `9,90`.');
        return;
      }

      const product = await addProduct({
        name,
        description,
        price,
        deliveryMessage,
        deliveryRoleId: deliveryRole?.id,
        position
      });

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ✅ Produto adicionado\n**ID:** \`${product.id}\`\n**Posição:** ${product.position}\n**Nome:** ${product.name}\n**Preço:** R$ ${formatPrice(product.price)}\n**Descrição:** ${product.description}\n**Cargo de entrega:** ${deliveryRole ? `<@&${deliveryRole.id}>` : 'Nenhum'}`
        )
      );

      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    // /editarproduto — mostra a lista de produtos com um menu para escolher qual editar
    if (interaction.commandName === 'editarproduto') {
      if (!(await isStoreModerator(interaction))) {
        await interaction.reply({ content: 'Você não tem permissão para gerenciar produtos da loja.', flags: MessageFlags.Ephemeral });
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
      if (!(await isStoreModerator(interaction))) {
        await interaction.reply({ content: 'Você não tem permissão para gerenciar produtos da loja.', flags: MessageFlags.Ephemeral });
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
      if (!(await isStoreAdmin(interaction))) {
        await interaction.reply({
          content: 'Apenas o dono do servidor ou o cargo admin da loja pode configurar a loja.',
          flags: MessageFlags.Ephemeral
        });
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

    // /permissoes
    if (interaction.commandName === 'permissoes') {
      if (!isGuildOwner(interaction)) {
        await interaction.reply({
          content: 'Apenas o dono do servidor pode configurar as permissões da loja (evita que alguém se dê mais acesso sozinho).',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const cargoAdmin = interaction.options.getRole('cargo_admin');
      const cargoModerador = interaction.options.getRole('cargo_moderador');
      const removerAdmin = interaction.options.getBoolean('remover_admin') ?? false;
      const removerModerador = interaction.options.getBoolean('remover_moderador') ?? false;

      const semMudancas = !cargoAdmin && !cargoModerador && !removerAdmin && !removerModerador;

      if (semMudancas) {
        const current = await getStoreSettings();
        await interaction.editReply(
          `## ⚙️ Permissões atuais da loja\n` +
            `**Cargo admin** (configura a loja + gerencia produtos): ${current.adminRoleId ? `<@&${current.adminRoleId}>` : 'Não definido (só o dono do servidor)'}\n` +
            `**Cargo moderador** (só gerencia produtos): ${current.moderatorRoleId ? `<@&${current.moderatorRoleId}>` : 'Não definido'}`
        );
        return;
      }

      const updated = await updateStoreSettings({
        adminRoleId: removerAdmin ? null : cargoAdmin?.id,
        moderatorRoleId: removerModerador ? null : cargoModerador?.id
      });

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ✅ Permissões atualizadas\n` +
            `**Cargo admin:** ${updated.adminRoleId ? `<@&${updated.adminRoleId}>` : 'Não definido (só o dono do servidor)'}\n` +
            `**Cargo moderador:** ${updated.moderatorRoleId ? `<@&${updated.moderatorRoleId}>` : 'Não definido'}`
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

      await interaction.update(buildEditProductOverviewReply(product));
    }
  } catch (error) {
    console.error('Erro ao processar menu de seleção:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: toUserErrorMessage(error), flags: MessageFlags.Ephemeral });
    }
  }
});

// Menus de seleção de cargo (RoleSelectMenu)
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isRoleSelectMenu()) return;

  try {
    if (interaction.customId.startsWith('editarproduto:role:')) {
      const productId = Number(interaction.customId.split(':')[2]);
      const roleId = interaction.values[0];

      const updated = await setProductDeliveryRole(productId, roleId);

      if (!updated) {
        await interaction.reply({ content: 'Produto não encontrado (pode ter sido removido).', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.update(buildEditProductOverviewReply(updated));
    }
  } catch (error) {
    console.error('Erro ao processar seleção de cargo:', error);
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

      const updated = await editProduct(productId, { name, price, description, deliveryMessage, position });

      if (!updated) {
        await interaction.reply({ content: 'Produto não encontrado (pode ter sido removido).', flags: MessageFlags.Ephemeral });
        return;
      }

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
    if (interaction.customId.startsWith('editarproduto:editbtn:')) {
      const productId = Number(interaction.customId.split(':')[2]);
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
      return;
    }

    if (interaction.customId.startsWith('editarproduto:clearrole:')) {
      const productId = Number(interaction.customId.split(':')[2]);
      const updated = await setProductDeliveryRole(productId, null);

      if (!updated) {
        await interaction.reply({ content: 'Produto não encontrado (pode ter sido removido).', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.update(buildEditProductOverviewReply(updated));
      return;
    }

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

      const { order, pix, reused } = await buildPixOrder(interaction.user.id, interaction.guildId ?? undefined, product);

      if (!pix.paymentId || !pix.qrCode) {
        await interaction.editReply('Não foi possível gerar o PIX. Tente novamente em alguns minutos.');
        return;
      }

      await interaction.editReply(buildPixPaymentReply(order, pix, reused));
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
        const alreadyApproved = order.status === 'approved';
        const updated = await updateOrder(order.id, { status: 'approved' });

        if (!alreadyApproved) {
          await deliverOrder(client, updated ?? order);
        }

        const roleNote = order.product.deliveryRoleId ? '\n🎭 O cargo de acesso foi liberado automaticamente pra você.' : '';
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ✅ Pagamento aprovado!\n${order.product.deliveryMessage}${roleNote}`)
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

async function migrateWithRetry(maxAttempts = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await migrate();
      console.log('Banco de dados PostgreSQL pronto (tabelas verificadas/criadas).');
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isLastAttempt = attempt === maxAttempts;

      console.error(`Tentativa ${attempt}/${maxAttempts} de conectar ao banco de dados falhou: ${message}`);

      if (isLastAttempt) {
        console.error(
          'Não foi possível conectar ao banco de dados após várias tentativas. Verifique DATABASE_URL/DATABASE_PUBLIC_URL. O bot vai continuar rodando, mas comandos que dependem do banco vão falhar até o próximo redeploy.'
        );
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

const CLEANUP_INTERVAL_MS = 5 * 60_000; // roda a cada 5 minutos

async function cleanupExpiredOrdersJob() {
  try {
    const cancelled = await cancelExpiredOrders();
    if (cancelled.length > 0) {
      console.log(
        `${cancelled.length} pedido(s) pendente(s) expiraram (mais de ${ORDER_EXPIRATION_MINUTES} min sem pagamento) e foram marcados como cancelados.`
      );
    }
  } catch (error) {
    console.error('Falha ao limpar pedidos expirados:', error);
  }
}

if (missingEnv.length > 0) {
  console.error(`Bot iniciado em modo de configuração incompleta. Defina as variáveis no Railway: ${missingEnv.join(', ')}`);
} else {
  await migrateWithRetry();

  await cleanupExpiredOrdersJob();
  setInterval(cleanupExpiredOrdersJob, CLEANUP_INTERVAL_MS);

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
