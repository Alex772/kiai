import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { commands } from './commands.js';
import { assertRequiredEnv, config } from './config.js';

assertRequiredEnv();

const rest = new REST({ version: '10' }).setToken(config.discordToken);

const route = config.discordGuildId
  ? Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId)
  : Routes.applicationCommands(config.discordClientId);

await rest.put(route, { body: commands });
console.log(`Registrados ${commands.length} comandos slash.`);
