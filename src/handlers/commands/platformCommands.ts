import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { isBotOwner } from '../../permissions.js';
import { getCommissionPercent, setCommissionPercent } from '../../platformSettings.js';

export async function handleComissao(interaction: ChatInputCommandInteraction) {
  if (!isBotOwner(interaction)) {
    await interaction.reply({ content: 'Esse comando é só pra quem administra o bot.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const percentual = interaction.options.getNumber('percentual');

  if (percentual === null) {
    const current = await getCommissionPercent();
    await interaction.editReply(
      `## 💰 Taxa de comissão atual\n**${current}%** sobre cada venda de servidores conectados via \`/mercadopago conectar\`.\n\n` +
        `Servidores que ainda usam o token global do bot (não conectaram nada) não geram comissão — nesse caso, o dinheiro já é todo seu.`
    );
    return;
  }

  await setCommissionPercent(percentual);

  await interaction.editReply(
    `## ✅ Taxa de comissão atualizada\nAgora **${percentual}%** de cada venda de servidores conectados vai automaticamente pra sua conta, via split de pagamento do Mercado Pago. Vale só pra vendas novas a partir de agora.`
  );
}
