import { Events, type AutocompleteInteraction } from 'discord.js';
import { client } from '../client.js';
import { formatPrice } from '../format.js';
import { STATUS_LABEL } from '../orderDisplay.js';
import { listCommissionTiers } from '../platformSettings.js';
import { listProducts } from '../products.js';
import { listOrdersByUser } from '../store.js';

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isAutocomplete()) return;

  try {
    const autocomplete = interaction as AutocompleteInteraction;
    const focused = autocomplete.options.getFocused().toLowerCase();

    if (['comprar', 'removerproduto'].includes(autocomplete.commandName)) {
      if (!autocomplete.guildId) {
        await autocomplete.respond([]);
        return;
      }
      const products = await listProducts(autocomplete.guildId);
      const choices = products
        .filter((p) => p.name.toLowerCase().includes(focused) || String(p.id).includes(focused))
        .slice(0, 25)
        .map((p) => ({ name: `${p.name} — R$ ${formatPrice(p.price)}`, value: String(p.id) }));

      await autocomplete.respond(choices);
      return;
    }

    if (autocomplete.commandName === 'pedido') {
      if (!autocomplete.guildId) {
        await autocomplete.respond([]);
        return;
      }
      const orders = await listOrdersByUser(autocomplete.user.id, autocomplete.guildId, 25);
      const choices = orders
        .filter((o) => o.id.includes(focused) || o.product.name.toLowerCase().includes(focused))
        .map((o) => ({
          name: `${o.product.name} — ${STATUS_LABEL[o.status]} — ${o.id.slice(0, 8)}`,
          value: o.id
        }));

      await autocomplete.respond(choices);
    }

    if (autocomplete.commandName === 'taxas') {
      const tiers = await listCommissionTiers();
      const choices = tiers
        .filter((t) => String(t.id).includes(focused) || String(t.maxAmount).includes(focused))
        .slice(0, 25)
        .map((t) => ({ name: `#${t.id} — até R$ ${t.maxAmount.toFixed(2)} → ${t.percent}%`, value: t.id }));

      await autocomplete.respond(choices);
    }
  } catch (error) {
    console.error('Erro no autocomplete:', error);
  }
});
