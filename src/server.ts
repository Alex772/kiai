import { createServer, type IncomingMessage } from 'node:http';
import type { Client } from 'discord.js';
import { config } from './config.js';
import { deliverOrder } from './delivery.js';
import { getPaymentDetails } from './mercadoPago.js';
import { findOrderByPaymentId, getOrder, updateOrder } from './store.js';
import { verifyMercadoPagoSignature } from './webhookSecurity.js';

type RuntimeStatus = {
  discordReady: boolean;
  missingEnv: string[];
};

const MAX_BODY_BYTES = 1_000_000; // 1 MB — suficiente para qualquer payload de webhook do Mercado Pago

function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Corpo da requisição excede o tamanho máximo permitido.'));
        request.destroy();
        return;
      }
      raw += chunk;
    });

    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });

    request.on('error', reject);
  });
}

// Rate limit simples em memória para o endpoint de webhook (protege contra flood/DoS básico).
const requestTimestamps = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = (requestTimestamps.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestTimestamps.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

function getClientIp(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return request.socket.remoteAddress ?? 'unknown';
}

export function startHttpServer(
  client: Client,
  getRuntimeStatus: () => RuntimeStatus = () => ({ discordReady: client.isReady(), missingEnv: [] })
) {
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
      const ip = getClientIp(request);

      if (isRateLimited(ip)) {
        response.writeHead(429, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'rate_limited' }));
        return;
      }

      try {
        const status = getRuntimeStatus();
        if (status.missingEnv.length > 0) {
          response.writeHead(503, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'missing_required_env', missingEnv: status.missingEnv }));
          return;
        }

        const url = new URL(request.url, 'http://internal');
        const dataIdFromQuery = url.searchParams.get('data.id') ?? undefined;

        if (config.mercadoPagoWebhookSecret) {
          const isValid = verifyMercadoPagoSignature({
            xSignature: request.headers['x-signature'] as string | undefined,
            xRequestId: request.headers['x-request-id'] as string | undefined,
            dataId: dataIdFromQuery,
            secret: config.mercadoPagoWebhookSecret
          });

          if (!isValid) {
            console.warn(`Webhook do Mercado Pago rejeitado: assinatura inválida (ip=${ip}).`);
            response.writeHead(401, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'invalid_signature' }));
            return;
          }
        } else {
          console.warn(
            'MERCADO_PAGO_WEBHOOK_SECRET não configurado: pulando validação de assinatura do webhook. Configure essa variável para maior segurança.'
          );
        }

        const body = await readJsonBody(request);
        const paymentId = String(body.data && typeof body.data === 'object' ? (body.data as { id?: unknown }).id : body.id);

        if (paymentId && paymentId !== 'undefined') {
          const details = await getPaymentDetails(paymentId);

          // Busca primeiro pelo external_reference (= ID do nosso pedido) — funciona tanto para
          // PIX quanto para cartão. Cai para busca por paymentId só como compatibilidade extra.
          const order = (details.externalReference && (await getOrder(details.externalReference))) || (await findOrderByPaymentId(paymentId));

          if (order && details.status === 'approved' && order.status !== 'approved') {
            const updated = await updateOrder(order.id, { status: 'approved', paymentId });
            await deliverOrder(client, updated ?? order);
          } else if (order && !order.paymentId) {
            // Guarda o paymentId assim que descobrimos (útil para /pedido e a verificação automática).
            await updateOrder(order.id, { paymentId });
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

    if (request.method === 'GET' && request.url?.startsWith('/checkout/return')) {
      const url = new URL(request.url, 'http://internal');
      const status = url.searchParams.get('status') ?? 'pending';

      const messages: Record<string, string> = {
        success: '✅ Pagamento recebido! Pode fechar esta aba e voltar ao Discord — a entrega é liberada automaticamente em instantes.',
        pending: '⏳ Pagamento em processamento. Pode fechar esta aba e voltar ao Discord — avisamos assim que for aprovado.',
        failure: '❌ Não foi possível concluir o pagamento. Pode fechar esta aba e tentar novamente pelo Discord.'
      };

      const message = messages[status] ?? messages.pending;

      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pagamento</title>
<style>
  body { font-family: system-ui, sans-serif; background: #1e1f22; color: #f2f3f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; text-align: center; }
  .card { max-width: 420px; }
  p { font-size: 1.1rem; line-height: 1.5; }
</style>
</head>
<body><div class="card"><p>${message}</p></div></body>
</html>`);
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
