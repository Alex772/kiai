import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
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
