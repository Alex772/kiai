import { createServer, type IncomingMessage } from 'node:http';
import type { Client } from 'discord.js';
import { getPaymentStatus } from './mercadoPago.js';
import { findOrderByPaymentId, updateOrder } from './store.js';

type RuntimeStatus = {
  discordReady: boolean;
  missingEnv: string[];
};

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

export function startHttpServer(client: Client, getRuntimeStatus: () => RuntimeStatus) {
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      const status = getRuntimeStatus();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          ok: status.missingEnv.length === 0 && status.discordReady,
          discordReady: status.discordReady,
          missingEnv: status.missingEnv
        })
      );
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/webhooks/mercado-pago')) {
      try {
        const status = getRuntimeStatus();
        if (status.missingEnv.length > 0) {
          response.writeHead(503, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'missing_required_env', missingEnv: status.missingEnv }));
          return;
        }

        const body = await readJsonBody(request);
        const paymentId = String(body.data && typeof body.data === 'object' ? (body.data as { id?: unknown }).id : body.id);

        if (paymentId && paymentId !== 'undefined') {
          const paymentStatus = await getPaymentStatus(paymentId);
          const order = findOrderByPaymentId(paymentId);

          if (order && paymentStatus === 'approved' && order.status !== 'approved') {
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
