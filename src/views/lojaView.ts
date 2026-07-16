import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ContainerBuilder } from 'discord.js';
import { formatPrice } from '../format.js';
import { listProducts } from '../products.js';
import { getStoreSettings } from '../settings.js';

export async function buildLojaReply(guildId: string, requestedPage: number) {
  const [products, settings] = await Promise.all([listProducts(guildId), getStoreSettings(guildId)]);
  const perPage = Math.max(1, settings.itemsPerPage);
  const totalPages = Math.max(1, Math.ceil(products.length / perPage));
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  const start = (page - 1) * perPage;
  const pageProducts = products.slice(start, start + perPage);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${settings.title}\n${settings.description}`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  if (pageProducts.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('Nenhum produto disponível no momento.'));
  } else {
    for (const product of pageProducts) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ${product.name} — R$ ${formatPrice(product.price)}\n${product.description}`)
      );
      container.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`comprar:${product.id}`).setLabel(`Comprar ${product.name}`).setStyle(ButtonStyle.Primary)
        )
      );
    }
  }

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`loja:page:${page - 1}`).setLabel('◀ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
      new ButtonBuilder().setCustomId('loja:jump').setLabel(`Página ${page}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(totalPages <= 1),
      new ButtonBuilder().setCustomId(`loja:page:${page + 1}`).setLabel('Próxima ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages)
    )
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2 as MessageFlags.IsComponentsV2 };
}
