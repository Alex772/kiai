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

  return {
    count: commands.length,
    scope: config.discordGuildId ? `guild:${config.discordGuildId}` : 'global'
  };
}
