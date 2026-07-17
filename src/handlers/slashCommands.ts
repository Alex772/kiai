import { Events } from 'discord.js';
import { client } from '../client.js';
import { replyError } from '../permissions.js';
import { handleComprar, handleLoja } from './commands/storeCommands.js';
import { handleLojaConfig, handleLogs, handlePermissoes } from './commands/configCommands.js';
import { handleMercadoPago } from './commands/mercadoPagoCommands.js';
import { handleMeusBeneficios, handlePedido, handlePedidos, handleUsuario } from './commands/orderCommands.js';
import { handleAddProduto, handleEditarProduto, handleRemoverProduto } from './commands/productCommands.js';
import { handleComissao } from './commands/platformCommands.js';

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'loja':
        await handleLoja(interaction);
        return;
      case 'comprar':
        await handleComprar(interaction);
        return;
      case 'pedido':
        await handlePedido(interaction);
        return;
      case 'pedidos':
        await handlePedidos(interaction);
        return;
      case 'meusbeneficios':
        await handleMeusBeneficios(interaction);
        return;
      case 'usuario':
        await handleUsuario(interaction);
        return;
      case 'addproduto':
        await handleAddProduto(interaction);
        return;
      case 'editarproduto':
        await handleEditarProduto(interaction);
        return;
      case 'removerproduto':
        await handleRemoverProduto(interaction);
        return;
      case 'lojaconfig':
        await handleLojaConfig(interaction);
        return;
      case 'permissoes':
        await handlePermissoes(interaction);
        return;
      case 'logs':
        await handleLogs(interaction);
        return;
      case 'mercadopago':
        await handleMercadoPago(interaction);
        return;
      case 'comissao':
        await handleComissao(interaction);
        return;
    }
  } catch (error) {
    console.error('Erro ao processar comando slash:', error);
    await replyError(interaction, error);
  }
});
