import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { isBotOwner, isStoreAdmin } from '../../permissions.js';
import {
  createCommissionTier,
  deleteCommissionTier,
  findCommissionTier,
  getCommissionPercent,
  listCommissionTiers,
  setCommissionPercent,
  updateCommissionTier
} from '../../platformSettings.js';

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
      `## 💰 Taxa de comissão padrão\n**${current}%** sobre vendas de servidores conectados que não caem em nenhuma faixa específica (veja \`/taxas listar\`).\n\n` +
        `Servidores que ainda usam o token global do bot (não conectaram nada) não geram comissão — nesse caso, o dinheiro já é todo seu.`
    );
    return;
  }

  await setCommissionPercent(percentual);

  await interaction.editReply(
    `## ✅ Taxa padrão atualizada\nAgora **${percentual}%** é a taxa padrão pra qualquer venda que não caia em nenhuma faixa configurada em \`/taxas\`. Vale só pra vendas novas a partir de agora.`
  );
}

function formatTierLine(tier: { id: number; maxAmount: number; percent: number }) {
  return `**#${tier.id}** — até R$ ${tier.maxAmount.toFixed(2)} → **${tier.percent}%**`;
}

export async function handleTaxas(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'listar') {
    if (!(await isStoreAdmin(interaction)) && !isBotOwner(interaction)) {
      await interaction.reply({
        content: 'Você precisa ser dono do servidor, ter o cargo admin da loja, ou administrar o bot pra ver isso.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [tiers, defaultPercent] = await Promise.all([listCommissionTiers(), getCommissionPercent()]);

    if (tiers.length === 0) {
      await interaction.editReply(
        `## 💰 Faixas de comissão\nNenhuma faixa configurada ainda. Toda venda usa a taxa padrão: **${defaultPercent}%**.`
      );
      return;
    }

    const lines = tiers.map(formatTierLine).join('\n');
    await interaction.editReply(
      `## 💰 Faixas de comissão\n${lines}\n\n**Acima de R$ ${tiers[tiers.length - 1].maxAmount.toFixed(2)}** (ou qualquer valor fora das faixas): **${defaultPercent}%** (taxa padrão)`
    );
    return;
  }

  // criar, editar, remover: só o dono do bot
  if (!isBotOwner(interaction)) {
    await interaction.reply({ content: 'Esse comando é só pra quem administra o bot.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (sub === 'criar') {
    const valorMaximo = interaction.options.getNumber('valor_maximo', true);
    const percentual = interaction.options.getNumber('percentual', true);

    try {
      const tier = await createCommissionTier(valorMaximo, percentual);
      await interaction.editReply(`## ✅ Faixa criada\n${formatTierLine(tier)}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('duplicate key')) {
        await interaction.editReply(`Já existe uma faixa com valor máximo de R$ ${valorMaximo.toFixed(2)}. Use \`/taxas editar\` nela.`);
        return;
      }
      throw error;
    }
    return;
  }

  if (sub === 'editar') {
    const id = interaction.options.getInteger('faixa', true);
    const valorMaximo = interaction.options.getNumber('valor_maximo') ?? undefined;
    const percentual = interaction.options.getNumber('percentual') ?? undefined;

    if (valorMaximo === undefined && percentual === undefined) {
      await interaction.editReply('Informe ao menos `valor_maximo` ou `percentual` pra editar.');
      return;
    }

    try {
      const updated = await updateCommissionTier(id, { maxAmount: valorMaximo, percent: percentual });
      if (!updated) {
        await interaction.editReply('Faixa não encontrada.');
        return;
      }
      await interaction.editReply(`## ✅ Faixa atualizada\n${formatTierLine(updated)}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('duplicate key')) {
        await interaction.editReply(`Já existe outra faixa com esse valor máximo.`);
        return;
      }
      throw error;
    }
    return;
  }

  if (sub === 'remover') {
    const id = interaction.options.getInteger('faixa', true);
    const tier = await findCommissionTier(id);

    if (!tier) {
      await interaction.editReply('Faixa não encontrada.');
      return;
    }

    await deleteCommissionTier(id);
    await interaction.editReply(`## 🗑️ Faixa removida\n${formatTierLine(tier)}`);
  }
}
