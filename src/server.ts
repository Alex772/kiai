import { createServer, type IncomingMessage } from 'node:http';
import type { Client } from 'discord.js';
import { getPaymentStatus } from './mercadoPago.js';
import { findOrderByPaymentId, updateOrder } from './store.js';

function readJsonBody(request: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function startHttpServer(client: Client) {
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/webhooks/mercado-pago')) {
      try {
        const body = await readJsonBody(request);
        const paymentId = String(body.data && typeof body.data === 'object' ? (body.data as { id?: unknown }).id : body.id);

        if (paymentId && paymentId !== 'undefined') {
          const status = await getPaymentStatus(paymentId);
          const order = findOrderByPaymentId(paymentId);

          if (order && status === 'approved') {
            const updated = updateOrder(order.id, { status: 'approved' });
            const user = await client.users.fetch(order.userId);
            await user.send(`Pagamento aprovado para **${order.product.name}**.\n${updated?.product.deliveryMessage}`);
          }
        }

        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ received: true }));
      } catch (error) {
        console.error('Erro ao processar webhook Mercado Pago:', error);
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'webhook_failed' }));
      }
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => {
    console.log(`Servidor HTTP ouvindo na porta ${port}`);
  });
}
