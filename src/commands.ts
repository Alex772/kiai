import { SlashCommandBuilder } from 'discord.js';
import { products } from './products.js';

export const commands = [
  new SlashCommandBuilder().setName('loja').setDescription('Mostra os produtos disponíveis na loja.'),
  new SlashCommandBuilder()
    .setName('comprar')
    .setDescription('Gera um pagamento PIX para comprar um produto.')
    .addStringOption((option) =>
      option
        .setName('produto')
        .setDescription('Produto que você deseja comprar')
        .setRequired(true)
        .addChoices(...products.map((product) => ({ name: `${product.name} - R$ ${product.price.toFixed(2)}`, value: product.id })))
    ),
  new SlashCommandBuilder()
    .setName('pedido')
    .setDescription('Consulta o status de um pedido.')
    .addStringOption((option) => option.setName('id').setDescription('ID do pedido').setRequired(true))
].map((command) => command.toJSON());
