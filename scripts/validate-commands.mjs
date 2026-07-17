// Valida os limites da API de comandos do Discord (nome/descrição <= 100 chars, etc)
// antes de empacotar/entregar, pra nunca mais um comando quebrar o boot do bot silenciosamente.
//
// Importante: os builders do discord.js (SlashCommandBuilder) validam esses limites na hora de
// CONSTRUIR o comando (ex: .setDescription(...) já lança erro se passar de 100 caracteres) — ou
// seja, o próprio import de commands.js pode falhar antes da nossa validação rodar. Por isso o
// import é dinâmico, dentro de um try/catch, pra sempre mostrar uma mensagem clara em vez do
// stack trace bruto do discord.js.

let commandsModule;

try {
  commandsModule = await import('../dist/commands.js');
} catch (error) {
  console.error('❌ Falha ao construir os comandos — provavelmente um nome/descrição passou do limite do Discord (32/100 caracteres).');
  console.error(`   Erro original: ${error.message}`);
  process.exit(1);
}

const { commands } = commandsModule;

let errors = 0;

function checkLength(label, value, max) {
  if (typeof value === 'string' && value.length > max) {
    console.error(`❌ ${label} tem ${value.length} caracteres (máximo ${max}): "${value}"`);
    errors++;
  }
}

function checkOptions(commandName, options) {
  for (const option of options ?? []) {
    checkLength(`/${commandName} → opção "${option.name}" (nome)`, option.name, 32);
    checkLength(`/${commandName} → opção "${option.name}" (descrição)`, option.description, 100);
    // Subcomandos (type SUB_COMMAND / SUB_COMMAND_GROUP) também têm suas próprias opções aninhadas.
    if (option.options) checkOptions(`${commandName} ${option.name}`, option.options);
  }
}

for (const command of commands) {
  checkLength(`Comando /${command.name} (nome)`, command.name, 32);
  checkLength(`Comando /${command.name} (descrição)`, command.description, 100);
  checkOptions(command.name, command.options);
}

if (errors > 0) {
  console.error(`\n${errors} problema(s) encontrado(s). Corrija antes de fazer deploy.`);
  process.exit(1);
} else {
  console.log(`✅ Todos os ${commands.length} comandos estão dentro dos limites do Discord.`);
}
