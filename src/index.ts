import { Events } from 'discord.js';
import { client } from './client.js';
import { config, getMissingRequiredEnv } from './config.js';
import { clearStaleGuildCommands, registerSlashCommands } from './registerSlashCommands.js';
import { startHttpServer } from './server.js';
import { scheduleJobs, migrateWithRetry } from './jobs.js';

// Cada import abaixo registra seus próprios listeners de interação (client.on(...)) como efeito
// colateral — mantém este arquivo só como o ponto de entrada, sem lógica de comando aqui dentro.
import './handlers/autocomplete.js';
import './handlers/slashCommands.js';
import './handlers/selectMenus.js';
import './handlers/roleSelectMenus.js';
import './handlers/modals.js';
import './handlers/buttons.js';

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot conectado como ${readyClient.user.tag}`);

  try {
    await clearStaleGuildCommands(readyClient);
  } catch (error) {
    console.error('Falha ao limpar comandos de servidor antigos:', error);
  }
});

startHttpServer(client, () => ({
  discordReady: client.isReady(),
  missingEnv: getMissingRequiredEnv()
}));

const missingEnv = getMissingRequiredEnv();

if (missingEnv.length > 0) {
  console.error(`Bot iniciado em modo de configuração incompleta. Defina as variáveis no Railway: ${missingEnv.join(', ')}`);
} else {
  await migrateWithRetry();
  await scheduleJobs();

  if (config.autoRegisterCommands) {
    try {
      const result = await registerSlashCommands();
      console.log(`Registrados ${result.count} comandos slash automaticamente no escopo ${result.scope}.`);
    } catch (error) {
      console.error('Falha ao registrar comandos slash automaticamente:', error);
    }
  }

  await client.login(config.discordToken);
}
