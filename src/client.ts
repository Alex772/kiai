import { Client, Events, GatewayIntentBits } from 'discord.js';

export const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on(Events.Error, (error) => {
  console.error('Erro do cliente Discord:', error);
});
