import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ContainerBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { isStoreModerator } from '../../permissions.js';
import { benefitsSectionContent, orderDetailContent, orderSummaryLine } from '../../orderDisplay.js';
import { listActiveRoleGrantsForUser, listOrdersByUser, getOrder } from '../../store.js';

export async function handlePedido(interaction: ChatInputCommandInteraction) {
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
}

export async function handlePedidos(interaction: ChatInputCommandInteraction) {
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
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(orderSummaryLine(order)));
    }
  }

  await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

export async function handleMeusBeneficios(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.guildId) {
    await interaction.editReply('Esse comando só funciona dentro de um servidor.');
    return;
  }

  const grants = await listActiveRoleGrantsForUser(interaction.user.id, interaction.guildId);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(benefitsSectionContent('## 🎭 Seus benefícios ativos', grants));

  await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

export async function handleUsuario(interaction: ChatInputCommandInteraction) {
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
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(orderSummaryLine(order)));
    }
  }

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(benefitsSectionContent('### 🎭 Benefícios ativos', grants));

  await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}
