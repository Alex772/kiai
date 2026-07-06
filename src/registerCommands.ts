import { assertRequiredEnv } from './config.js';
import { registerSlashCommands } from './registerSlashCommands.js';

assertRequiredEnv();

const result = await registerSlashCommands();
console.log(`Registrados ${result.count} comandos slash no escopo ${result.scope}.`);
