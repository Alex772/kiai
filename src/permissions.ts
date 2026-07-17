import { MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { config } from './config.js';
import { toUserErrorMessage } from './errors.js';
import { getStoreSettings } from './settings.js';

export async function replyError(interaction: ChatInputCommandInteraction | ButtonInteraction, error: unknown) {
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

/** Dono do bot em si (não de um servidor específico) — controla configurações globais, como a comissão da plataforma. */
export function isBotOwner(interaction: ChatInputCommandInteraction): boolean {
  return Boolean(config.botOwnerId) && interaction.user.id === config.botOwnerId;
}

export function isGuildOwner(interaction: ChatInputCommandInteraction): boolean {
  if (interaction.guild?.ownerId === interaction.user.id) return true;
  if (config.adminRoleId && interaction.inCachedGuild()) {
    return interaction.member.roles.cache.has(config.adminRoleId);
  }
  return false;
}

/** Acesso total: dono do servidor, cargo legado ADMIN_ROLE_ID (env) ou cargo admin configurado via /permissoes. */
export async function isStoreAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (isGuildOwner(interaction)) return true;
  if (!interaction.inCachedGuild()) return false;

  const settings = await getStoreSettings(interaction.guildId);
  return settings.adminRoleId ? interaction.member.roles.cache.has(settings.adminRoleId) : false;
}

/** Acesso limitado (gerenciar produtos): tudo que isStoreAdmin cobre, mais o cargo moderador configurado. */
export async function isStoreModerator(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (await isStoreAdmin(interaction)) return true;
  if (!interaction.inCachedGuild()) return false;

  const settings = await getStoreSettings(interaction.guildId);
  return settings.moderatorRoleId ? interaction.member.roles.cache.has(settings.moderatorRoleId) : false;
}
