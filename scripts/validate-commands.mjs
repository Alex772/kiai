// Valida os limites da API de comandos do Discord (nome/descrição <= 100 chars, etc)
// antes de empacotar/entregar, pra nunca mais um comando quebrar o boot do bot silenciosamente.
import { commands } from '../dist/commands.js';

let errors = 0;

function checkLength(label, value, max) {
  if (typeof value === 'string' && value.length > max) {
    console.error(`❌ ${label} tem ${value.length} caracteres (máximo ${max}): "${value}"`);
    errors++;
  }
}

for (const command of commands) {
  checkLength(`Comando /${command.name} (nome)`, command.name, 32);
  checkLength(`Comando /${command.name} (descrição)`, command.description, 100);

  for (const option of command.options ?? []) {
    checkLength(`/${command.name} → opção "${option.name}" (nome)`, option.name, 32);
    checkLength(`/${command.name} → opção "${option.name}" (descrição)`, option.description, 100);
  }
}

if (errors > 0) {
  console.error(`\n${errors} problema(s) encontrado(s). Corrija antes de fazer deploy.`);
  process.exit(1);
} else {
  console.log(`✅ Todos os ${commands.length} comandos estão dentro dos limites do Discord.`);
}
