import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('loja')
    .setDescription('Abre a loja interativa com paginação.'),

  new SlashCommandBuilder()
    .setName('comprar')
    .setDescription('Compra um produto da loja via PIX (Mercado Pago).')
    .addStringOption((o) =>
      o.setName('produto').setDescription('Produto que deseja comprar').setRequired(true).setAutocomplete(true)
    ),

  new SlashCommandBuilder()
    .setName('pedido')
    .setDescription('Consulta o status detalhado de um pedido.')
    .addStringOption((o) =>
      o.setName('id').setDescription('ID do pedido').setRequired(true).setAutocomplete(true)
    ),

  new SlashCommandBuilder()
    .setName('pedidos')
    .setDescription('Lista os seus pedidos mais recentes.'),

  new SlashCommandBuilder()
    .setName('addproduto')
    .setDescription('Adiciona um produto à loja. (Apenas dono do servidor)')
    .addStringOption((o) => o.setName('nome').setDescription('Nome do produto').setRequired(true))
    .addStringOption((o) => o.setName('preco').setDescription('Preço em R$ (ex: 9,90)').setRequired(true))
    .addStringOption((o) => o.setName('descricao').setDescription('Descrição do produto').setRequired(true))
    .addStringOption((o) => o.setName('entrega').setDescription('Mensagem enviada após pagamento aprovado').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('posicao').setDescription('Posição na loja (opcional; padrão: final da lista)').setRequired(false).setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName('editarproduto')
    .setDescription('Mostra a lista de produtos da loja para editar. (Apenas dono do servidor)'),

  new SlashCommandBuilder()
    .setName('removerproduto')
    .setDescription('Remove um produto da loja. (Apenas dono do servidor)')
    .addStringOption((o) =>
      o.setName('produto').setDescription('Produto a remover').setRequired(true).setAutocomplete(true)
    ),

  new SlashCommandBuilder()
    .setName('lojaconfig')
    .setDescription('Configura a aparência e o comportamento da loja. (Apenas dono do servidor)')
    .addIntegerOption((o) =>
      o.setName('itens_por_pagina').setDescription('Quantos produtos mostrar por página (1-10)').setRequired(false).setMinValue(1).setMaxValue(10)
    )
    .addStringOption((o) => o.setName('titulo').setDescription('Título exibido no topo da loja').setRequired(false))
    .addStringOption((o) => o.setName('descricao').setDescription('Texto exibido abaixo do título').setRequired(false))
].map((command) => command.toJSON());
