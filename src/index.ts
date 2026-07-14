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
import { addDurationToDate, formatDuration, formatRemaining, parseDuration } from './duration.js';
import { toUserErrorMessage } from './errors.js';
import { formatPrice, parsePrice } from './format.js';
import { diffFields, logAdmin, logSale, LOG_COLOR } from './logging.js';
import {
  createPixPayment,
  createCardCheckoutLink,
  resolveOrderPaymentStatus,
  getPaymentDetails,
  searchPaymentByExternalReference
} from './mercadoPago.js';
import {
  addProduct,
  countProducts,
  editProduct,
  findProduct,
  listProducts,
  removeProduct,
  setProductDeliveryRole,
  setProductDeliveryRoleDuration,
  type Product
} from './products.js';
import { getStoreSettings, updateStoreSettings } from './settings.js';
import {
  createOrder,
  findRecentPendingOrder,
  cancelExpiredOrders,
  listPendingOrdersWithPayment,
  listPendingCardOrdersWithoutPayment,
  listExpiredRoleGrants,
  listActiveRoleGrantsForUser,
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

  const settings = await getStoreSettings(interaction.guildId);
  return settings.adminRoleId ? interaction.member.roles.cache.has(settings.adminRoleId) : false;
}

/** Acesso limitado (gerenciar produtos): tudo que isStoreAdmin cobre, mais o cargo moderador configurado. */
async function isStoreModerator(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (await isStoreAdmin(interaction)) return true;
  if (!interaction.inCachedGuild()) return false;

  const settings = await getStoreSettings(interaction.guildId);
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
    `**Forma de pagamento:** ${order.paymentMethod === 'pix' ? '💠 PIX' : '💳 Cartão'}`,
    `**Status:** ${STATUS_LABEL[order.status]}`,
    order.product.deliveryRoleId ? `**Cargo de entrega:** <@&${order.product.deliveryRoleId}>` : undefined,
    order.paymentId ? `**ID do pagamento (Mercado Pago):** \`${order.paymentId}\`` : undefined,
    `**Criado em:** ${formatDate(order.createdAt)}`,
    `**Última atualização:** ${formatDate(order.updatedAt)}`
  ].filter(Boolean);

  return lines.join('\n');
}

function benefitsSectionContent(title: string, grants: Order[]) {
  if (grants.length === 0) {
    return new TextDisplayBuilder().setContent(`${title}\nNenhum benefício ativo no momento.`);
  }

  const lines = grants.map((order) => {
    const roleMention = order.product.deliveryRoleId ? `<@&${order.product.deliveryRoleId}>` : order.product.name;
    if (!order.roleExpiresAt) {
      return `${roleMention} — **permanente** (\`${order.id}\`)`;
    }
    const expiresAt = new Date(order.roleExpiresAt);
    return `${roleMention} — expira em **${formatRemaining(expiresAt)}** (${formatDate(order.roleExpiresAt)}) — \`${order.id}\``;
  });

  return new TextDisplayBuilder().setContent(`${title}\n${lines.join('\n')}`);
}

function buildPaymentMethodChoiceReply(product: Product) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${product.name}\n${product.description}\n\n**Valor:** R$ ${formatPrice(product.price)}\n\nComo você quer pagar?\n-# 💳 O pagamento por cartão atualmente exige entrar ou criar uma conta Mercado Pago na hora de pagar.`
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`pagarpix:${product.id}`).setLabel('💠 PIX').setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`pagarcartao:${product.id}`)
        .setLabel('💳 Cartão (requer conta Mercado Pago)')
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2 };
}

async function buildPixOrder(userId: string, guildId: string, product: Product) {
  const existing = await findRecentPendingOrder(userId, product.id, 'pix');

  if (existing && existing.paymentId && existing.qrCode) {
    return {
      order: existing,
      pix: { paymentId: existing.paymentId, qrCode: existing.qrCode, qrCodeBase64: existing.qrCodeBase64 },
      reused: true
    };
  }

  const order = await createOrder({ id: randomUUID(), userId, guildId, product, paymentMethod: 'pix' });
  const pix = await createPixPayment(order);
  const updated = await updateOrder(order.id, {
    paymentId: pix.paymentId,
    qrCode: pix.qrCode,
    qrCodeBase64: pix.qrCodeBase64
  });

  await logSale(client, guildId, {
    title: '🛒 Pedido criado (PIX)',
    description:
      `**Comprador:** <@${userId}> (\`${userId}\`)\n**Produto:** ${product.name}\n**Valor:** R$ ${formatPrice(product.price)}\n**Pedido:** \`${order.id}\``,
    color: LOG_COLOR.created
  });

  return { order: updated ?? order, pix, reused: false };
}

async function buildCardOrder(userId: string, guildId: string, product: Product) {
  const existing = await findRecentPendingOrder(userId, product.id, 'card');

  if (existing && existing.checkoutUrl) {
    return { order: existing, checkoutUrl: existing.checkoutUrl, reused: true };
  }

  const order = await createOrder({ id: randomUUID(), userId, guildId, product, paymentMethod: 'card' });
  const { checkoutUrl } = await createCardCheckoutLink(order);
  const updated = await updateOrder(order.id, { checkoutUrl });

  await logSale(client, guildId, {
    title: '🛒 Pedido criado (Cartão)',
    description:
      `**Comprador:** <@${userId}> (\`${userId}\`)\n**Produto:** ${product.name}\n**Valor:** R$ ${formatPrice(product.price)}\n**Pedido:** \`${order.id}\``,
    color: LOG_COLOR.created
  });

  return { order: updated ?? order, checkoutUrl, reused: false };
}

function buildPixPaymentReply(order: Order, pix: { qrCode?: string; qrCodeBase64?: string }, reused = false) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 💠 Pagamento PIX — ${order.product.name}`)
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

function buildCardPaymentReply(order: Order, checkoutUrl: string, reused = false) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 💳 Pagamento com cartão — ${order.product.name}`)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**Pedido:** \`${order.id}\`\n**Valor:** R$ ${formatPrice(order.product.price)}\n\n` +
        `${reused ? 'Você já tinha um pagamento em aberto para este produto — aqui está o link de novo.' : 'Clique no botão abaixo para pagar com cartão de crédito ou débito numa página segura do Mercado Pago.'} ` +
        `Seus dados de cartão nunca passam pelo Discord ou pelo bot.\n\n` +
        `⚠️ **Atualmente é necessário entrar ou criar uma conta Mercado Pago** para concluir o pagamento com cartão (é rápido e gratuito). O bot avisará por DM quando o pagamento for aprovado.`
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel('Abrir pagamento seguro').setStyle(ButtonStyle.Link).setURL(checkoutUrl)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`check:${order.id}`).setLabel('Verificar pagamento').setStyle(ButtonStyle.Success)
    )
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2 };
}

async function buildLojaReply(guildId: string, requestedPage: number) {
  const [products, settings] = await Promise.all([listProducts(guildId), getStoreSettings(guildId)]);
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
        `**Cargo de entrega:** ${product.deliveryRoleId ? `<@&${product.deliveryRoleId}>` : 'Nenhum'}\n` +
        `**Duração do cargo:** ${product.deliveryRoleId ? (product.deliveryRoleDuration ? formatDuration(product.deliveryRoleDuration) : 'Permanente') : '—'}`
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
    const roleButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`editarproduto:duration:${product.id}`)
        .setLabel('⏱️ Definir duração do cargo')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`editarproduto:clearrole:${product.id}`)
        .setLabel('🗑️ Remover cargo de entrega')
        .setStyle(ButtonStyle.Danger)
    );
    container.addActionRowComponents(roleButtons);
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
      if (!autocomplete.guildId) {
        await autocomplete.respond([]);
        return;
      }
      const products = await listProducts(autocomplete.guildId);
      const choices = products
        .filter((p) => p.name.toLowerCase().includes(focused) || String(p.id).includes(focused))
        .slice(0, 25)
        .map((p) => ({ name: `${p.name} — R$ ${formatPrice(p.price)}`, value: String(p.id) }));

      await autocomplete.respond(choices);
      return;
    }

    if (autocomplete.commandName === 'pedido') {
      if (!autocomplete.guildId) {
        await autocomplete.respond([]);
        return;
      }
      const orders = await listOrdersByUser(autocomplete.user.id, autocomplete.guildId, 25);
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

      if (!interaction.guildId) {
        await interaction.editReply('Esse comando só funciona dentro de um servidor.');
        return;
      }

      await interaction.editReply(await buildLojaReply(interaction.guildId, 1));
      return;
    }

    // /comprar
    if (interaction.commandName === 'comprar') {
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

      if (order.status === 'pending' || order.status === 'cancelled') {
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

      if (!interaction.guildId) {
        await interaction.editReply('Esse comando só funciona dentro de um servidor.');
        return;
      }

      const orders = await listOrdersByUser(interaction.user.id, interaction.guildId, 10);

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## 📜 Seus últimos pedidos'));
      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

      if (orders.length === 0) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('Você ainda não fez nenhum pedido.'));
      } else {
        for (const order of orders) {
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `**${order.product.name}** — R$ ${formatPrice(order.product.price)} — ${order.paymentMethod === 'pix' ? '💠' : '💳'} — ${STATUS_LABEL[order.status]}\n\`${order.id}\` • ${formatDate(order.createdAt)}`
            )
          );
        }
      }

      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    // /meusbeneficios
    if (interaction.commandName === 'meusbeneficios') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      if (!interaction.guildId) {
        await interaction.editReply('Esse comando só funciona dentro de um servidor.');
        return;
      }

      const grants = await listActiveRoleGrantsForUser(interaction.user.id, interaction.guildId);

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(benefitsSectionContent('## 🎭 Seus benefícios ativos', grants));

      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    // /usuario
    if (interaction.commandName === 'usuario') {
      if (!(await isStoreModerator(interaction))) {
        await interaction.reply({ content: 'Você não tem permissão para consultar dados de usuários.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      if (!interaction.guildId) {
        await interaction.editReply('Esse comando só funciona dentro de um servidor.');
        return;
      }

      const target = interaction.options.getUser('usuario', true);
      const [orders, grants] = await Promise.all([
        listOrdersByUser(target.id, interaction.guildId, 10),
        listActiveRoleGrantsForUser(target.id, interaction.guildId)
      ]);

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 👤 ${target.tag}\n\`${target.id}\``));
      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('### 📜 Últimos pedidos'));
      if (orders.length === 0) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('Nenhum pedido encontrado.'));
      } else {
        for (const order of orders) {
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `**${order.product.name}** — R$ ${formatPrice(order.product.price)} — ${order.paymentMethod === 'pix' ? '💠' : '💳'} — ${STATUS_LABEL[order.status]}\n\`${order.id}\` • ${formatDate(order.createdAt)}`
            )
          );
        }
      }

      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
      container.addTextDisplayComponents(benefitsSectionContent('### 🎭 Benefícios ativos', grants));

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

      if (!interaction.guildId) {
        await interaction.editReply('Esse comando só funciona dentro de um servidor.');
        return;
      }

      const name = interaction.options.getString('nome', true);
      const priceRaw = interaction.options.getString('preco', true);
      const description = interaction.options.getString('descricao', true);
      const deliveryMessage = interaction.options.getString('entrega', true);
      const deliveryRole = interaction.options.getRole('cargo') ?? undefined;
      const durationRaw = interaction.options.getString('duracao_cargo') ?? undefined;
      const position = interaction.options.getInteger('posicao') ?? undefined;

      const price = parsePrice(priceRaw);

      if (price === undefined || price <= 0) {
        await interaction.editReply('Preço inválido. Use um valor como `9,90`.');
        return;
      }

      let deliveryRoleDuration = undefined;
      if (durationRaw) {
        deliveryRoleDuration = parseDuration(durationRaw);
        if (!deliveryRoleDuration) {
          await interaction.editReply('Duração inválida. Use um formato como `30 dias`, `1 mes`, `1 ano`, `12 horas`.');
          return;
        }
        if (!deliveryRole) {
          await interaction.editReply('`duracao_cargo` só funciona se você também escolher um `cargo`.');
          return;
        }
      }

      const product = await addProduct(interaction.guildId, {
        name,
        description,
        price,
        deliveryMessage,
        deliveryRoleId: deliveryRole?.id,
        deliveryRoleDuration,
        position
      });

      const durationText = deliveryRoleDuration ? formatDuration(deliveryRoleDuration) : 'Permanente';

      await logAdmin(client, interaction.guildId, {
        actor: interaction.user,
        title: '➕ Produto adicionado',
        description:
          `**ID:** \`${product.id}\` • **Posição:** ${product.position}\n**Nome:** ${product.name}\n**Preço:** R$ ${formatPrice(product.price)}\n` +
          `**Descrição:** ${product.description}\n**Mensagem de entrega:** ${product.deliveryMessage}\n**Cargo de entrega:** ${deliveryRole ? `<@&${deliveryRole.id}>` : 'Nenhum'}` +
          (deliveryRole ? `\n**Duração do cargo:** ${durationText}` : ''),
        color: LOG_COLOR.added
      });

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ✅ Produto adicionado\n**ID:** \`${product.id}\`\n**Posição:** ${product.position}\n**Nome:** ${product.name}\n**Preço:** R$ ${formatPrice(product.price)}\n**Descrição:** ${product.description}\n**Cargo de entrega:** ${deliveryRole ? `<@&${deliveryRole.id}>` : 'Nenhum'}${deliveryRole ? `\n**Duração do cargo:** ${durationText}` : ''}`
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

      if (!interaction.guildId) {
        await interaction.editReply('Esse comando só funciona dentro de um servidor.');
        return;
      }

      const products = await listProducts(interaction.guildId);

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

      await removeProduct(interaction.guildId, productId);

      await logAdmin(client, interaction.guildId, {
        actor: interaction.user,
        title: '🗑️ Produto removido',
        description: `**ID:** \`${product.id}\`\n**Nome:** ${product.name}\n**Preço:** R$ ${formatPrice(product.price)}\n**Cargo de entrega:** ${product.deliveryRoleId ? `<@&${product.deliveryRoleId}>` : 'Nenhum'}`,
        color: LOG_COLOR.removed
      });

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

      if (!interaction.guildId) {
        await interaction.editReply('Esse comando só funciona dentro de um servidor.');
        return;
      }

      const itemsPerPage = interaction.options.getInteger('itens_por_pagina') ?? undefined;
      const title = interaction.options.getString('titulo') ?? undefined;
      const description = interaction.options.getString('descricao') ?? undefined;

      if (itemsPerPage === undefined && title === undefined && description === undefined) {
        const current = await getStoreSettings(interaction.guildId);
        await interaction.editReply(
          `## ⚙️ Configuração atual da loja\n**Itens por página:** ${current.itemsPerPage}\n**Título:** ${current.title}\n**Descrição:** ${current.description}`
        );
        return;
      }

      const before = await getStoreSettings(interaction.guildId);
      const updated = await updateStoreSettings(interaction.guildId, { itemsPerPage, title, description });

      await logAdmin(client, interaction.guildId, {
        actor: interaction.user,
        title: '⚙️ Configuração da loja alterada',
        description: diffFields(
          { 'Itens por página': String(before.itemsPerPage), Título: before.title, Descrição: before.description },
          { 'Itens por página': String(updated.itemsPerPage), Título: updated.title, Descrição: updated.description }
        ),
        color: LOG_COLOR.edited
      });

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

      if (!interaction.guildId) {
        await interaction.editReply('Esse comando só funciona dentro de um servidor.');
        return;
      }

      const cargoAdmin = interaction.options.getRole('cargo_admin');
      const cargoModerador = interaction.options.getRole('cargo_moderador');
      const removerAdmin = interaction.options.getBoolean('remover_admin') ?? false;
      const removerModerador = interaction.options.getBoolean('remover_moderador') ?? false;

      const semMudancas = !cargoAdmin && !cargoModerador && !removerAdmin && !removerModerador;

      if (semMudancas) {
        const current = await getStoreSettings(interaction.guildId);
        await interaction.editReply(
          `## ⚙️ Permissões atuais da loja\n` +
            `**Cargo admin** (configura a loja + gerencia produtos): ${current.adminRoleId ? `<@&${current.adminRoleId}>` : 'Não definido (só o dono do servidor)'}\n` +
            `**Cargo moderador** (só gerencia produtos): ${current.moderatorRoleId ? `<@&${current.moderatorRoleId}>` : 'Não definido'}`
        );
        return;
      }

      const updated = await updateStoreSettings(interaction.guildId, {
        adminRoleId: removerAdmin ? null : cargoAdmin?.id,
        moderatorRoleId: removerModerador ? null : cargoModerador?.id
      });

      await logAdmin(client, interaction.guildId, {
        actor: interaction.user,
        title: '🔐 Permissões da loja alteradas',
        description:
          `**Cargo admin:** ${updated.adminRoleId ? `<@&${updated.adminRoleId}>` : 'Não definido'}\n` +
          `**Cargo moderador:** ${updated.moderatorRoleId ? `<@&${updated.moderatorRoleId}>` : 'Não definido'}`,
        color: LOG_COLOR.sensitive
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

    // /logs
    if (interaction.commandName === 'logs') {
      if (!isGuildOwner(interaction)) {
        await interaction.reply({
          content: 'Apenas o dono do servidor pode configurar os canais de log.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      if (!interaction.guildId) {
        await interaction.editReply('Esse comando só funciona dentro de um servidor.');
        return;
      }

      const canalVendas = interaction.options.getChannel('canal_vendas');
      const canalAdmin = interaction.options.getChannel('canal_admin');
      const removerVendas = interaction.options.getBoolean('remover_vendas') ?? false;
      const removerAdmin = interaction.options.getBoolean('remover_admin') ?? false;

      const semMudancas = !canalVendas && !canalAdmin && !removerVendas && !removerAdmin;

      if (semMudancas) {
        const current = await getStoreSettings(interaction.guildId);
        await interaction.editReply(
          `## 📋 Canais de log atuais\n` +
            `**Vendas/compras:** ${current.salesLogChannelId ? `<#${current.salesLogChannelId}>` : 'Não configurado'}\n` +
            `**Admin (sensível):** ${current.adminLogChannelId ? `<#${current.adminLogChannelId}>` : 'Não configurado'}\n\n` +
            `Dica: no canal admin, restrinja a visualização apenas para você nas permissões do canal do Discord — o bot só posta lá, não controla quem enxerga o canal.`
        );
        return;
      }

      const updated = await updateStoreSettings(interaction.guildId, {
        salesLogChannelId: removerVendas ? null : canalVendas?.id,
        adminLogChannelId: removerAdmin ? null : canalAdmin?.id
      });

      await logAdmin(client, interaction.guildId, {
        actor: interaction.user,
        title: '📋 Canais de log alterados',
        description:
          `**Vendas/compras:** ${updated.salesLogChannelId ? `<#${updated.salesLogChannelId}>` : 'Não configurado'}\n` +
          `**Admin:** ${updated.adminLogChannelId ? `<#${updated.adminLogChannelId}>` : 'Não configurado'}`,
        color: LOG_COLOR.sensitive
      });

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ✅ Canais de log atualizados\n` +
            `**Vendas/compras:** ${updated.salesLogChannelId ? `<#${updated.salesLogChannelId}>` : 'Não configurado'}\n` +
            `**Admin (sensível):** ${updated.adminLogChannelId ? `<#${updated.adminLogChannelId}>` : 'Não configurado'}\n\n` +
            (updated.adminLogChannelId
              ? `⚠️ Lembre-se de restringir quem pode ver o canal admin nas permissões do Discord — o bot posta lá, mas não controla visibilidade.`
              : '')
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

// Modais
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isModalSubmit()) return;

  try {
    if (interaction.customId.startsWith('editarproduto:modal:')) {
      if (!interaction.guildId) {
        await interaction.reply({ content: 'Esse comando só funciona dentro de um servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      const productId = Number(interaction.customId.split(':')[2]);
      const before = await findProduct(interaction.guildId, productId);

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

      const updated = await editProduct(interaction.guildId, productId, { name, price, description, deliveryMessage, position });

      if (!updated) {
        await interaction.reply({ content: 'Produto não encontrado (pode ter sido removido).', flags: MessageFlags.Ephemeral });
        return;
      }

      if (before) {
        await logAdmin(client, interaction.guildId, {
          actor: interaction.user,
          title: '✏️ Produto editado',
          description:
            `**Produto:** ${updated.name} (\`${updated.id}\`)\n` +
            diffFields(
              {
                Nome: before.name,
                Preço: `R$ ${formatPrice(before.price)}`,
                Descrição: before.description,
                'Mensagem de entrega': before.deliveryMessage,
                Posição: String(before.position)
              },
              {
                Nome: updated.name,
                Preço: `R$ ${formatPrice(updated.price)}`,
                Descrição: updated.description,
                'Mensagem de entrega': updated.deliveryMessage,
                Posição: String(updated.position)
              }
            ),
          color: LOG_COLOR.edited
        });
      }

      if (interaction.isFromMessage()) {
        await interaction.update(buildEditProductOverviewReply(updated));
      } else {
        await interaction.reply({ components: buildEditProductOverviewReply(updated).components, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      }
      return;
    }

    if (interaction.customId.startsWith('editarproduto:durationmodal:')) {
      if (!interaction.guildId) {
        await interaction.reply({ content: 'Esse comando só funciona dentro de um servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      const productId = Number(interaction.customId.split(':')[2]);
      const before = await findProduct(interaction.guildId, productId);
      const raw = interaction.fields.getTextInputValue('duracao').trim();

      const duration = raw ? parseDuration(raw) : undefined;

      if (raw && !duration) {
        await interaction.reply({
          content: 'Duração inválida. Use um formato como `30 dias`, `1 mes`, `1 ano`, `12 horas`, ou deixe vazio para permanente.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const updated = await setProductDeliveryRoleDuration(interaction.guildId, productId, duration ?? null);

      if (!updated) {
        await interaction.reply({ content: 'Produto não encontrado (pode ter sido removido).', flags: MessageFlags.Ephemeral });
        return;
      }

      await logAdmin(client, interaction.guildId, {
        actor: interaction.user,
        title: '⏱️ Duração do cargo de entrega alterada',
        description:
          `**Produto:** ${updated.name} (\`${updated.id}\`)\n` +
          `**Antes:** ${before?.deliveryRoleDuration ? formatDuration(before.deliveryRoleDuration) : 'Permanente'}\n` +
          `**Agora:** ${duration ? formatDuration(duration) : 'Permanente'}`,
        color: LOG_COLOR.edited
      });

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

      if (interaction.isFromMessage() && interaction.guildId) {
        await interaction.update(await buildLojaReply(interaction.guildId, targetPage));
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
      if (!interaction.guildId) {
        await interaction.reply({ content: 'Esse comando só funciona dentro de um servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      const productId = Number(interaction.customId.split(':')[2]);
      const product = await findProduct(interaction.guildId, productId);

      if (!product) {
        await interaction.reply({ content: 'Produto não encontrado (pode ter sido removido).', flags: MessageFlags.Ephemeral });
        return;
      }

      const total = await countProducts(interaction.guildId);

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
      if (!interaction.guildId) {
        await interaction.reply({ content: 'Esse comando só funciona dentro de um servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      const productId = Number(interaction.customId.split(':')[2]);
      const before = await findProduct(interaction.guildId, productId);
      const updated = await setProductDeliveryRole(interaction.guildId, productId, null);

      if (!updated) {
        await interaction.reply({ content: 'Produto não encontrado (pode ter sido removido).', flags: MessageFlags.Ephemeral });
        return;
      }

      await logAdmin(client, interaction.guildId, {
        actor: interaction.user,
        title: '🎭 Cargo de entrega removido',
        description: `**Produto:** ${updated.name} (\`${updated.id}\`)\n**Cargo removido:** ${before?.deliveryRoleId ? `<@&${before.deliveryRoleId}>` : 'Nenhum'}`,
        color: LOG_COLOR.removed
      });

      await interaction.update(buildEditProductOverviewReply(updated));
      return;
    }

    if (interaction.customId.startsWith('editarproduto:duration:')) {
      if (!interaction.guildId) {
        await interaction.reply({ content: 'Esse comando só funciona dentro de um servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      const productId = Number(interaction.customId.split(':')[2]);
      const product = await findProduct(interaction.guildId, productId);

      if (!product) {
        await interaction.reply({ content: 'Produto não encontrado (pode ter sido removido).', flags: MessageFlags.Ephemeral });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`editarproduto:durationmodal:${productId}`)
        .setTitle('Duração do cargo de entrega');

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('duracao')
            .setLabel('Ex: 30 dias, 1 mes, 1 ano, 12 horas')
            .setStyle(TextInputStyle.Short)
            .setValue(product.deliveryRoleDuration ? formatDuration(product.deliveryRoleDuration) : '')
            .setPlaceholder('Deixe vazio para permanente')
            .setRequired(false)
            .setMaxLength(30)
        )
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId.startsWith('loja:page:')) {
      if (!interaction.guildId) {
        await interaction.reply({ content: 'Esse comando só funciona dentro de um servidor.', flags: MessageFlags.Ephemeral });
        return;
      }
      const targetPage = Number(interaction.customId.split(':')[2]);
      await interaction.update(await buildLojaReply(interaction.guildId, targetPage));
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

      if (!interaction.guildId) {
        await interaction.editReply('Esse comando só funciona dentro de um servidor.');
        return;
      }

      const productId = Number(interaction.customId.replace('comprar:', ''));
      const product = await findProduct(interaction.guildId, productId);

      if (!product) {
        await interaction.editReply('Produto não encontrado (pode ter sido removido).');
        return;
      }

      await interaction.editReply(buildPaymentMethodChoiceReply(product));
      return;
    }

    if (interaction.customId.startsWith('pagarpix:')) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      if (!interaction.guildId) {
        await interaction.editReply('Esse comando só funciona dentro de um servidor.');
        return;
      }

      const productId = Number(interaction.customId.replace('pagarpix:', ''));
      const product = await findProduct(interaction.guildId, productId);

      if (!product) {
        await interaction.editReply('Produto não encontrado (pode ter sido removido).');
        return;
      }

      const { order, pix, reused } = await buildPixOrder(interaction.user.id, interaction.guildId, product);

      if (!pix.paymentId || !pix.qrCode) {
        await interaction.editReply('Não foi possível gerar o PIX. Tente novamente em alguns minutos.');
        return;
      }

      await interaction.editReply(buildPixPaymentReply(order, pix, reused));
      return;
    }

    if (interaction.customId.startsWith('pagarcartao:')) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      if (!interaction.guildId) {
        await interaction.editReply('Esse comando só funciona dentro de um servidor.');
        return;
      }

      const productId = Number(interaction.customId.replace('pagarcartao:', ''));
      const product = await findProduct(interaction.guildId, productId);

      if (!product) {
        await interaction.editReply('Produto não encontrado (pode ter sido removido).');
        return;
      }

      const { order, checkoutUrl, reused } = await buildCardOrder(interaction.user.id, interaction.guildId, product);

      if (!checkoutUrl) {
        await interaction.editReply(
          'Não foi possível gerar o link de pagamento com cartão. Verifique se `PUBLIC_BASE_URL` está configurado, ou tente novamente em alguns minutos.'
        );
        return;
      }

      await interaction.editReply(buildCardPaymentReply(order, checkoutUrl, reused));
      return;
    }

    if (interaction.customId.startsWith('check:')) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const orderId = interaction.customId.replace('check:', '');
      const order = await getOrder(orderId);

      if (!order || order.userId !== interaction.user.id) {
        await interaction.editReply('Pedido não encontrado para sua conta.');
        return;
      }

      const { status, paymentId } = await resolveOrderPaymentStatus(order);
      const container = new ContainerBuilder();

      if (status === 'approved') {
        const alreadyApproved = order.status === 'approved';
        const updated = await updateOrder(order.id, { status: 'approved', paymentId: paymentId ?? order.paymentId });

        if (!alreadyApproved) {
          await deliverOrder(client, updated ?? order);
        }

        const roleNote = order.product.deliveryRoleId ? '\n🎭 O cargo de acesso foi liberado automaticamente pra você.' : '';
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ✅ Pagamento aprovado!\n${order.product.deliveryMessage}${roleNote}`)
        );
      } else {
        if (paymentId && paymentId !== order.paymentId) {
          await updateOrder(order.id, { paymentId });
        }

        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## ⏳ Pagamento pendente\nStatus atual no Mercado Pago: **${status ?? 'ainda não iniciado'}**`
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
const PAYMENT_POLL_INTERVAL_MS = 2 * 60_000; // roda a cada 2 minutos
const ROLE_EXPIRATION_INTERVAL_MS = 5 * 60_000; // roda a cada 5 minutos

/**
 * Remove automaticamente o cargo de quem comprou um benefício por tempo limitado, assim que o
 * prazo vence. Avisa o comprador por DM e registra nos dois canais de log (vendas e admin).
 */
async function expireRoleGrantsJob() {
  try {
    const expired = await listExpiredRoleGrants();

    for (const order of expired) {
      try {
        let removed = false;

        if (order.guildId && order.product.deliveryRoleId) {
          try {
            const guild = await client.guilds.fetch(order.guildId);
            const member = await guild.members.fetch(order.userId).catch(() => undefined);
            if (member) {
              await member.roles.remove(order.product.deliveryRoleId, `Benefício expirado — pedido ${order.id}`);
              removed = true;
            }
          } catch (error) {
            console.error(`Falha ao remover cargo expirado do pedido ${order.id}:`, error);
          }
        }

        await updateOrder(order.id, { roleRemovedAt: new Date().toISOString() });

        try {
          const user = await client.users.fetch(order.userId);
          await user.send(
            `⏰ Seu acesso de **${order.product.name}** expirou${removed ? ' e o cargo foi removido' : ''}. Se quiser continuar com acesso, é só comprar de novo!`
          );
        } catch (error) {
          console.error(`Falha ao avisar por DM sobre expiração do pedido ${order.id}:`, error);
        }

        if (order.guildId) {
          await logSale(client, order.guildId, {
            title: '⏰ Benefício expirado',
            description: `<@${order.userId}> — ${order.product.name} (\`${order.id}\`)`,
            color: LOG_COLOR.expired
          });

          await logAdmin(client, order.guildId, {
            title: '⏰ Cargo removido automaticamente (prazo expirado)',
            description:
              `**Usuário:** <@${order.userId}>\n**Produto:** ${order.product.name}\n` +
              `**Cargo:** ${order.product.deliveryRoleId ? `<@&${order.product.deliveryRoleId}>` : '—'}\n**Pedido:** \`${order.id}\`\n` +
              `**Removido do Discord:** ${removed ? '✅ Sim' : '⚠️ Não (membro não encontrado no servidor, ou cargo já removido manualmente)'}`,
            color: LOG_COLOR.warning
          });
        }
      } catch (error) {
        console.error(`Falha ao processar expiração do pedido ${order.id}:`, error);
      }
    }
  } catch (error) {
    console.error('Falha ao rodar a expiração automática de cargos:', error);
  }
}

async function cleanupExpiredOrdersJob() {
  try {
    const cancelled = await cancelExpiredOrders();
    if (cancelled.length > 0) {
      console.log(
        `${cancelled.length} pedido(s) pendente(s) expiraram (mais de ${ORDER_EXPIRATION_MINUTES} min sem pagamento) e foram marcados como cancelados.`
      );

      const byGuild = new Map<string, Order[]>();
      for (const order of cancelled) {
        if (!order.guildId) continue;
        const list = byGuild.get(order.guildId) ?? [];
        list.push(order);
        byGuild.set(order.guildId, list);
      }

      for (const [guildId, orders] of byGuild) {
        await logSale(client, guildId, {
          title: `🕐 ${orders.length} pedido(s) expirado(s)`,
          description: orders
            .map((o) => `<@${o.userId}> — ${o.product.name} — R$ ${formatPrice(o.product.price)} (\`${o.id}\`)`)
            .join('\n'),
          color: LOG_COLOR.expired
        });
      }
    }
  } catch (error) {
    console.error('Falha ao limpar pedidos expirados:', error);
  }
}

/**
 * Verificação automática de pagamentos pendentes — funciona como um "backup" caso a notificação
 * (webhook) do Mercado Pago não chegue por algum motivo (PUBLIC_BASE_URL errado, instabilidade de
 * rede, etc). Sem isso, a entrega (cargo + DM) só aconteceria se o usuário clicasse manualmente em
 * "Verificar pagamento". Roda a cada poucos minutos e consulta a API do Mercado Pago diretamente.
 */
async function pollPendingPaymentsJob() {
  try {
    const pending = await listPendingOrdersWithPayment();

    for (const order of pending) {
      if (!order.paymentId) continue;

      try {
        const status = await getPaymentDetails(order.paymentId).then((d) => d.status);

        if (status === 'approved') {
          const updated = await updateOrder(order.id, { status: 'approved' });
          await deliverOrder(client, updated ?? order);
          console.log(`Pedido ${order.id} aprovado detectado pela verificação automática (webhook não chegou a tempo).`);
        } else if (status === 'rejected' || status === 'cancelled') {
          await updateOrder(order.id, { status: status === 'rejected' ? 'rejected' : 'cancelled' });
        }
      } catch (error) {
        console.error(`Falha ao verificar automaticamente o pagamento do pedido ${order.id}:`, error);
      }
    }

    // Pedidos de cartão ainda não têm paymentId até o comprador terminar o checkout — busca por
    // external_reference pra descobrir se algum já foi pago, mesmo sem o webhook ter avisado.
    const pendingCard = await listPendingCardOrdersWithoutPayment();

    for (const order of pendingCard) {
      try {
        const found = await searchPaymentByExternalReference(order.id);
        if (!found) continue;

        if (found.status === 'approved') {
          const updated = await updateOrder(order.id, { status: 'approved', paymentId: found.id });
          await deliverOrder(client, updated ?? order);
          console.log(`Pedido ${order.id} (cartão) aprovado detectado pela verificação automática.`);
        } else {
          await updateOrder(order.id, { paymentId: found.id });
        }
      } catch (error) {
        console.error(`Falha ao verificar automaticamente o pagamento (cartão) do pedido ${order.id}:`, error);
      }
    }
  } catch (error) {
    console.error('Falha ao rodar a verificação automática de pagamentos pendentes:', error);
  }
}

if (missingEnv.length > 0) {
  console.error(`Bot iniciado em modo de configuração incompleta. Defina as variáveis no Railway: ${missingEnv.join(', ')}`);
} else {
  await migrateWithRetry();

  await cleanupExpiredOrdersJob();
  setInterval(cleanupExpiredOrdersJob, CLEANUP_INTERVAL_MS);

  setInterval(pollPendingPaymentsJob, PAYMENT_POLL_INTERVAL_MS);

  await expireRoleGrantsJob();
  setInterval(expireRoleGrantsJob, ROLE_EXPIRATION_INTERVAL_MS);

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
