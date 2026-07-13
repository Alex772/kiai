import { ChannelType, SlashCommandBuilder } from 'discord.js';

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
    .setDescription('Adiciona um produto à loja. (Dono do servidor ou cargo autorizado)')
    .addStringOption((o) => o.setName('nome').setDescription('Nome do produto').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('preco').setDescription('Preço em R$ (ex: 9,90)').setRequired(true).setMaxLength(20))
    .addStringOption((o) => o.setName('descricao').setDescription('Descrição do produto').setRequired(true).setMaxLength(500))
    .addStringOption((o) =>
      o.setName('entrega').setDescription('Mensagem enviada após pagamento aprovado').setRequired(true).setMaxLength(1000)
    )
    .addRoleOption((o) =>
      o.setName('cargo').setDescription('Cargo do Discord entregue automaticamente ao aprovar o pagamento (opcional)').setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName('duracao_cargo')
        .setDescription('Por quanto tempo o cargo fica ativo (ex: 30 dias, 1 mes, 1 ano). Só funciona junto com "cargo". Vazio = permanente.')
        .setRequired(false)
        .setMaxLength(30)
    )
    .addIntegerOption((o) =>
      o.setName('posicao').setDescription('Posição na loja (opcional; padrão: final da lista)').setRequired(false).setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName('editarproduto')
    .setDescription('Mostra a lista de produtos da loja para editar. (Dono do servidor ou cargo autorizado)'),

  new SlashCommandBuilder()
    .setName('removerproduto')
    .setDescription('Remove um produto da loja. (Dono do servidor ou cargo autorizado)')
    .addStringOption((o) =>
      o.setName('produto').setDescription('Produto a remover').setRequired(true).setAutocomplete(true)
    ),

  new SlashCommandBuilder()
    .setName('meusbeneficios')
    .setDescription('Mostra seus cargos/benefícios ativos e quanto tempo falta pra cada um expirar.'),

  new SlashCommandBuilder()
    .setName('usuario')
    .setDescription('Consulta o histórico de compras e benefícios ativos de um usuário. (Dono do servidor ou cargo autorizado)')
    .addUserOption((o) => o.setName('usuario').setDescription('Usuário a consultar').setRequired(true)),

  new SlashCommandBuilder()
    .setName('lojaconfig')
    .setDescription('Configura a aparência e o comportamento da loja. (Dono do servidor ou cargo admin)')
    .addIntegerOption((o) =>
      o.setName('itens_por_pagina').setDescription('Quantos produtos mostrar por página (1-10)').setRequired(false).setMinValue(1).setMaxValue(10)
    )
    .addStringOption((o) => o.setName('titulo').setDescription('Título exibido no topo da loja').setRequired(false))
    .addStringOption((o) => o.setName('descricao').setDescription('Texto exibido abaixo do título').setRequired(false)),

  new SlashCommandBuilder()
    .setName('permissoes')
    .setDescription('Configura quais cargos administram a loja. (Apenas dono do servidor)')
    .addRoleOption((o) =>
      o.setName('cargo_admin').setDescription('Cargo com acesso total: configura a loja e gerencia produtos').setRequired(false)
    )
    .addRoleOption((o) =>
      o.setName('cargo_moderador').setDescription('Cargo com acesso limitado: só gerencia produtos').setRequired(false)
    )
    .addBooleanOption((o) => o.setName('remover_admin').setDescription('Remove o cargo admin configurado').setRequired(false))
    .addBooleanOption((o) =>
      o.setName('remover_moderador').setDescription('Remove o cargo moderador configurado').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Configura os canais de log da loja. (Apenas dono do servidor)')
    .addChannelOption((o) =>
      o
        .setName('canal_vendas')
        .setDescription('Canal para o histórico de vendas/compras (quem comprou, o quê, quando, status)')
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildText)
    )
    .addChannelOption((o) =>
      o
        .setName('canal_admin')
        .setDescription('Canal para o log administrativo sensível (alterações em produtos, config e permissões)')
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildText)
    )
    .addBooleanOption((o) => o.setName('remover_vendas').setDescription('Remove o canal de log de vendas configurado').setRequired(false))
    .addBooleanOption((o) =>
      o.setName('remover_admin').setDescription('Remove o canal de log administrativo configurado').setRequired(false)
    )
].map((command) => command.toJSON());
