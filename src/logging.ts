import { EmbedBuilder, type Client, type ColorResolvable, type User } from 'discord.js';
import { getStoreSettings } from './settings.js';

const COLOR = {
  created: 0x3498db, // azul
  approved: 0x2ecc71, // verde
  expired: 0x95a5a6, // cinza
  added: 0x2ecc71, // verde
  edited: 0xf1c40f, // amarelo
  removed: 0xe74c3c, // vermelho
  sensitive: 0x9b59b6, // roxo
  warning: 0xe67e22 // laranja
} as const;

export { COLOR as LOG_COLOR };

async function sendToChannel(client: Client, channelId: string | undefined, embed: EmbedBuilder) {
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isTextBased() && 'send' in channel) {
      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error(`Falha ao enviar log para o canal ${channelId}:`, error);
  }
}

/**
 * Log de vendas/compras: histórico de quem comprou, o quê, quando e quando pagou.
 * Visível no canal configurado via /logs canal_vendas.
 */
export async function logSale(
  client: Client,
  guildId: string,
  opts: { title: string; description: string; color?: ColorResolvable }
) {
  const settings = await getStoreSettings(guildId);
  if (!settings.salesLogChannelId) return;

  const embed = new EmbedBuilder()
    .setTitle(opts.title)
    .setDescription(opts.description.slice(0, 4000))
    .setColor(opts.color ?? COLOR.created)
    .setTimestamp(new Date());

  await sendToChannel(client, settings.salesLogChannelId, embed);
}

/**
 * Log administrativo (sensível): qualquer alteração em produtos, configuração da loja ou permissões.
 * Serve como trilha de auditoria — quem mudou o quê. Visível no canal configurado via /logs canal_admin,
 * que o próprio dono do servidor deve restringir para si mesmo nas permissões do canal no Discord.
 */
export async function logAdmin(
  client: Client,
  guildId: string,
  opts: { actor?: User; title: string; description: string; color?: ColorResolvable }
) {
  const settings = await getStoreSettings(guildId);
  if (!settings.adminLogChannelId) return;

  const embed = new EmbedBuilder()
    .setTitle(opts.title)
    .setDescription(opts.description.slice(0, 4000))
    .setColor(opts.color ?? COLOR.edited)
    .setTimestamp(new Date());

  if (opts.actor) {
    embed.setAuthor({ name: opts.actor.tag, iconURL: opts.actor.displayAvatarURL() }).setFooter({ text: `ID: ${opts.actor.id}` });
  } else {
    embed.setAuthor({ name: 'Sistema (automático)' });
  }

  await sendToChannel(client, settings.adminLogChannelId, embed);
}

/**
 * Monta um texto de diff simples ("campo: antes → depois") só com os campos que realmente mudaram.
 * Usado nos logs administrativos de edição para deixar claro o que foi alterado.
 */
export function diffFields(before: Record<string, string>, after: Record<string, string>): string {
  const lines: string[] = [];

  for (const key of Object.keys(after)) {
    const beforeValue = before[key] ?? '';
    const afterValue = after[key] ?? '';
    if (beforeValue !== afterValue) {
      lines.push(`**${key}:** ${beforeValue || '_(vazio)_'} → ${afterValue || '_(vazio)_'}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : '_Nenhum campo alterado._';
}
