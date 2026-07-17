import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Client } from 'discord.js';
import { config } from './config.js';
import { deliverOrder } from './delivery.js';
import { exchangeAuthorizationCode, getPaymentDetails } from './mercadoPago.js';
import { findConnectionByMpUserId, listAllConnections } from './mpConnections.js';
import { findOrderByPaymentId, getOrder, updateOrder } from './store.js';
import { verifyMercadoPagoSignature } from './webhookSecurity.js';

// Guarda temporariamente qual servidor/usuário iniciou uma conexão OAuth, indexado pelo "state"
// (validade curta — só o tempo de o dono clicar no link e autorizar). Evita que alguém finalize
// uma conexão OAuth alheia adivinhando a URL (proteção CSRF).
const pendingOAuthStates = new Map<string, { guildId: string; userId: string; expiresAt: number }>();
const OAUTH_STATE_TTL_MS = 10 * 60_000; // 10 minutos — mesma validade do authorization code do MP

export function registerPendingOAuthState(guildId: string, userId: string): string {
  const now = Date.now();
  for (const [key, value] of pendingOAuthStates) {
    if (value.expiresAt < now) pendingOAuthStates.delete(key);
  }

  const state = randomUUID();
  pendingOAuthStates.set(state, { guildId, userId, expiresAt: now + OAUTH_STATE_TTL_MS });
  return state;
}

function consumePendingOAuthState(state: string) {
  const entry = pendingOAuthStates.get(state);
  if (!entry) return undefined;
  pendingOAuthStates.delete(state);
  if (entry.expiresAt < Date.now()) return undefined;
  return entry;
}

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
        // O Mercado Pago manda notificações em dois formatos pro mesmo evento: o novo ("Webhooks v2",
        // com ?data.id=X&type=payment) e o legado ("IPN", com ?id=X&topic=payment). O ID do pagamento
        // pode vir em qualquer um dos dois nomes de parâmetro.
        const dataIdFromQuery = url.searchParams.get('data.id') ?? url.searchParams.get('id') ?? undefined;

        if (config.mercadoPagoWebhookSecret) {
          console.log(`[webhook] URL recebida: ${url.pathname}${url.search} (data.id na query: ${dataIdFromQuery ?? '(nenhum)'})`);

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
        const paymentIdFromBody = String(
          body.data && typeof body.data === 'object' ? (body.data as { id?: unknown }).id : body.id
        );
        const paymentId = dataIdFromQuery ?? (paymentIdFromBody !== 'undefined' ? paymentIdFromBody : undefined);

        if (paymentId && paymentId !== 'undefined') {
          // O Mercado Pago manda o user_id (dono da conta que recebeu o pagamento) no corpo do
          // webhook — usamos isso pra descobrir de qual servidor é esse pagamento ANTES de saber
          // quais credenciais usar pra consultar os detalhes.
          const mpUserId = body.user_id !== undefined && body.user_id !== null ? String(body.user_id) : undefined;

          let guildIdForLookup: string | undefined;

          if (mpUserId) {
            const connection = await findConnectionByMpUserId(mpUserId);
            guildIdForLookup = connection?.guildId;
          }

          if (!guildIdForLookup) {
            // PIX já salva o paymentId na criação — dá pra achar o pedido (e o servidor) sem precisar
            // consultar o Mercado Pago ainda.
            const existingOrder = await findOrderByPaymentId(paymentId);
            guildIdForLookup = existingOrder?.guildId;
          }

          if (!guildIdForLookup) {
            // Último recurso: modo de servidor único legado (antes das conexões por servidor existirem).
            guildIdForLookup = config.discordGuildId;
          }

          if (guildIdForLookup) {
            const details = await getPaymentDetails(paymentId, guildIdForLookup);

            // Busca primeiro pelo external_reference (= ID do nosso pedido) — funciona tanto para
            // PIX quanto para cartão. Cai para busca por paymentId só como compatibilidade extra.
            const order =
              (details.externalReference && (await getOrder(details.externalReference))) || (await findOrderByPaymentId(paymentId));

            if (order && details.status === 'approved' && order.status !== 'approved') {
              const updated = await updateOrder(order.id, { status: 'approved', paymentId });
              await deliverOrder(client, updated ?? order);
            } else if (order && !order.paymentId) {
              // Guarda o paymentId assim que descobrimos (útil para /pedido e a verificação automática).
              await updateOrder(order.id, { paymentId });
            }
          } else {
            // Nenhuma pista de qual servidor é esse pagamento (típico de cartão numa conta que
            // acabou de conectar). Último recurso: tenta cada conta conectada até uma reconhecer
            // esse paymentId como seu. Caro (uma chamada por conta), mas só acontece nesse caso raro
            // — e a verificação automática periódica ainda pegaria isso de qualquer forma depois.
            const connections = await listAllConnections();
            let resolved = false;

            for (const connection of connections) {
              const details = await getPaymentDetails(paymentId, connection.guildId);
              if (!details.status && !details.externalReference) continue; // não pertence a essa conta

              resolved = true;
              const order =
                (details.externalReference && (await getOrder(details.externalReference))) || (await findOrderByPaymentId(paymentId));

              if (order && details.status === 'approved' && order.status !== 'approved') {
                const updated = await updateOrder(order.id, { status: 'approved', paymentId });
                await deliverOrder(client, updated ?? order);
              } else if (order && !order.paymentId) {
                await updateOrder(order.id, { paymentId });
              }
              break;
            }

            if (!resolved) {
              console.warn(`Webhook do Mercado Pago recebido, mas não foi possível determinar o servidor (payment_id=${paymentId}).`);
            }
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

    if (request.method === 'GET' && request.url?.startsWith('/mercadopago/callback')) {
      const url = new URL(request.url, 'http://internal');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const errorParam = url.searchParams.get('error');

      const respondHtml = (message: string, ok: boolean) => {
        response.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conectar Mercado Pago</title>
<style>
  body { font-family: system-ui, sans-serif; background: #1e1f22; color: #f2f3f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; text-align: center; }
  .card { max-width: 420px; }
  p { font-size: 1.1rem; line-height: 1.5; }
</style>
</head>
<body><div class="card"><p>${message}</p></div></body>
</html>`);
      };

      if (errorParam) {
        respondHtml('❌ Você recusou a autorização, ou algo deu errado. Pode fechar esta aba e tentar de novo pelo Discord com /conectarmercadopago.', false);
        return;
      }

      if (!code || !state) {
        respondHtml('❌ Link inválido ou incompleto. Peça um novo link com /conectarmercadopago no Discord.', false);
        return;
      }

      const pending = consumePendingOAuthState(state);
      if (!pending) {
        respondHtml('❌ Este link expirou ou já foi usado. Peça um novo com /conectarmercadopago no Discord (ele vale só 10 minutos).', false);
        return;
      }

      try {
        await exchangeAuthorizationCode(code, pending.guildId, pending.userId);
        respondHtml('✅ Conta Mercado Pago conectada com sucesso! Pode fechar esta aba e voltar ao Discord.', true);
      } catch (error) {
        console.error(`Falha ao concluir conexão OAuth do servidor ${pending.guildId}:`, error);
        respondHtml('❌ Não foi possível concluir a conexão com o Mercado Pago. Tente de novo pelo Discord com /conectarmercadopago.', false);
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
