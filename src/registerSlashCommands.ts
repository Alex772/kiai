import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import type { Client } from 'discord.js';
import { commands } from './commands.js';
import { config } from './config.js';

export async function registerSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);

  const route = config.discordGuildId
    ? Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId)
    : Routes.applicationCommands(config.discordClientId);

  await rest.put(route, { body: commands });

  if (config.discordGuildId) {
    console.warn(
      `AVISO: comandos registrados apenas no servidor ${config.discordGuildId} (DISCORD_GUILD_ID definida). ` +
        'Se o bot estiver ou for entrar em outros servidores, remova a variável DISCORD_GUILD_ID do Railway para registrar os comandos globalmente (aparecem em todo servidor, mas a primeira propagação pode levar até 1h).'
    );
  }

  return {
    count: commands.length,
    scope: config.discordGuildId ? `guild:${config.discordGuildId}` : 'global'
  };
}

/**
 * Remove comandos "de servidor" deixados para trás de quando o bot usava DISCORD_GUILD_ID
 * (registro por servidor). Sem isso, um servidor que já teve comandos registrados dessa forma
 * antiga passa a ver cada comando duplicado (a versão antiga de servidor + a nova global
 * coexistindo). Só roda quando o bot está em modo global (sem DISCORD_GUILD_ID definida) — se
 * DISCORD_GUILD_ID estiver definida, os comandos de servidor são os comandos "de verdade" e não
 * devem ser apagados. Precisa rodar depois do bot conectar (client.guilds.cache só existe então).
 */
export async function clearStaleGuildCommands(client: Client) {
  if (config.discordGuildId) return; // modo servidor único: nada a limpar

  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  let cleared = 0;

  for (const guild of client.guilds.cache.values()) {
    try {
      const existing = (await rest.get(Routes.applicationGuildCommands(config.discordClientId, guild.id))) as unknown[];
      if (existing.length === 0) continue;

      await rest.put(Routes.applicationGuildCommands(config.discordClientId, guild.id), { body: [] });
      cleared++;
      console.log(`Removidos ${existing.length} comando(s) "de servidor" antigo(s) em ${guild.name} (${guild.id}) — agora só os globais valem lá.`);
    } catch (error) {
      console.error(`Falha ao limpar comandos de servidor antigos em ${guild.id}:`, error);
    }
  }

  if (cleared > 0) {
    console.log(`Limpeza concluída: ${cleared} servidor(es) tinham comandos duplicados e foram corrigidos.`);
  }
}
