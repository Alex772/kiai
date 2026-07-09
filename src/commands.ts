import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('loja')
    .setDescription('Abre a loja interativa usando Components V2.'),

  new SlashCommandBuilder()
    .setName('addproduto')
    .setDescription('Adiciona um produto à loja. (Apenas dono do servidor)')
    .addStringOption((o) => o.setName('id').setDescription('ID único do produto (sem espaços)').setRequired(true))
    .addStringOption((o) => o.setName('nome').setDescription('Nome do produto').setRequired(true))
    .addNumberOption((o) => o.setName('preco').setDescription('Preço em R$').setRequired(true))
    .addStringOption((o) => o.setName('descricao').setDescription('Descrição do produto').setRequired(true))
    .addStringOption((o) => o.setName('entrega').setDescription('Mensagem enviada após pagamento aprovado').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removerproduto')
    .setDescription('Remove um produto da loja. (Apenas dono do servidor)')
    .addStringOption((o) =>
      o.setName('produto').setDescription('Produto a remover').setRequired(true).setAutocomplete(true)
    )
].map((command) => command.toJSON());
