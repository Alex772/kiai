import {
  ActionRowBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  ContainerBuilder,
  type ChatInputCommandInteraction
} from 'discord.js';
import { client } from '../../client.js';
import { formatDuration, parseDuration } from '../../duration.js';
import { formatPrice, parsePrice } from '../../format.js';
import { logAdmin, LOG_COLOR } from '../../logging.js';
import { isStoreModerator } from '../../permissions.js';
import { addProduct, findProduct, listProducts, removeProduct } from '../../products.js';

export async function handleAddProduto(interaction: ChatInputCommandInteraction) {
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
}

export async function handleEditarProduto(interaction: ChatInputCommandInteraction) {
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
}

export async function handleRemoverProduto(interaction: ChatInputCommandInteraction) {
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
}
