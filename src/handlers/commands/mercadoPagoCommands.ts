import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, TextDisplayBuilder, ContainerBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { client } from '../../client.js';
import { config } from '../../config.js';
import { toUserErrorMessage } from '../../errors.js';
import { logAdmin, LOG_COLOR } from '../../logging.js';
import { buildAuthorizationUrl, isOAuthConfigured } from '../../mercadoPago.js';
import { deleteMercadoPagoConnection, getMercadoPagoConnection } from '../../mpConnections.js';
import { isGuildOwner } from '../../permissions.js';
import { registerPendingOAuthState } from '../../server.js';

export async function handleMercadoPago(interaction: ChatInputCommandInteraction) {
  if (!isGuildOwner(interaction)) {
    await interaction.reply({
      content: 'Apenas o dono do servidor pode gerenciar a conexão com o Mercado Pago.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.guildId) {
    await interaction.editReply('Esse comando só funciona dentro de um servidor.');
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'conectar') {
    await handleConectar(interaction);
    return;
  }

  if (sub === 'status') {
    await handleStatus(interaction);
    return;
  }

  if (sub === 'desconectar') {
    await handleDesconectar(interaction);
    return;
  }
}

async function handleConectar(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) return;

  if (!isOAuthConfigured()) {
    await interaction.editReply(
      'A conexão de contas por servidor ainda não está habilitada neste bot (faltam `MERCADO_PAGO_CLIENT_ID`/`MERCADO_PAGO_CLIENT_SECRET` configurados). Fale com quem administra o bot.'
    );
    return;
  }

  if (!config.publicBaseUrl) {
    await interaction.editReply('`PUBLIC_BASE_URL` não está configurado no bot — não é possível gerar o link de conexão.');
    return;
  }

  let authUrl: string;
  try {
    const state = registerPendingOAuthState(interaction.guildId, interaction.user.id);
    authUrl = buildAuthorizationUrl(state);
  } catch (error) {
    await interaction.editReply(toUserErrorMessage(error));
    return;
  }

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## 🔗 Conectar conta Mercado Pago\nClique no botão abaixo e faça login com a conta Mercado Pago que vai receber os pagamentos desta loja. O link expira em 10 minutos.`
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel('Conectar Mercado Pago').setStyle(ButtonStyle.Link).setURL(authUrl)
    )
  );

  await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

async function handleStatus(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) return;

  const connection = await getMercadoPagoConnection(interaction.guildId);

  if (!connection) {
    await interaction.editReply(
      `## 🔌 Mercado Pago — não conectado\nEste servidor ainda não conectou uma conta própria.${config.mercadoPagoAccessToken ? ' Os pagamentos estão usando o token global padrão do bot.' : ' Nenhum pagamento pode ser processado até conectar uma conta com `/mercadopago conectar`.'}`
    );
    return;
  }

  const expiresAt = new Date(connection.expiresAt);
  await interaction.editReply(
    `## ✅ Mercado Pago conectado\n**Conta:** \`${connection.mpUserId ?? '—'}\`\n**Conectado por:** <@${connection.connectedBy ?? '—'}>\n**Renovação automática até:** ${expiresAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n\nO token é renovado automaticamente antes de vencer. Se algo der errado, rode \`/mercadopago conectar\` de novo.`
  );
}

async function handleDesconectar(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) return;

  const removed = await deleteMercadoPagoConnection(interaction.guildId);

  if (!removed) {
    await interaction.editReply('Este servidor não tinha nenhuma conta Mercado Pago conectada.');
    return;
  }

  await logAdmin(client, interaction.guildId, {
    actor: interaction.user,
    title: '🔌 Conta Mercado Pago desconectada',
    description: `A conexão da conta Mercado Pago deste servidor foi removida por <@${interaction.user.id}>.${config.mercadoPagoAccessToken ? ' Os pagamentos voltam a usar o token global padrão do bot.' : ' Nenhum pagamento pode ser processado até conectar uma conta de novo.'}`,
    color: LOG_COLOR.warning
  });

  await interaction.editReply(
    `## 🔌 Desconectado\nA conta Mercado Pago deste servidor foi desconectada.${config.mercadoPagoAccessToken ? ' Os pagamentos voltam a usar o token global padrão do bot.' : ' Use `/mercadopago conectar` para reconectar quando quiser vender de novo.'}`
  );
}
