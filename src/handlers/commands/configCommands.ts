import { MessageFlags, TextDisplayBuilder, ContainerBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { client } from '../../client.js';
import { diffFields, logAdmin, LOG_COLOR } from '../../logging.js';
import { isGuildOwner, isStoreAdmin } from '../../permissions.js';
import { getStoreSettings, updateStoreSettings } from '../../settings.js';

export async function handleLojaConfig(interaction: ChatInputCommandInteraction) {
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
}

export async function handlePermissoes(interaction: ChatInputCommandInteraction) {
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
}

export async function handleLogs(interaction: ChatInputCommandInteraction) {
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
}
