import { MercadoPagoConfig, OAuth, Payment, Preference } from 'mercadopago';
import { config } from './config.js';
import { describeError } from './errors.js';
import { getMercadoPagoConnection, saveMercadoPagoConnection, type MercadoPagoConnection } from './mpConnections.js';
import { getCommissionPercent } from './platformSettings.js';
import { ORDER_EXPIRATION_MINUTES, type Order } from './store.js';

type PixPaymentResponse = {
  id?: number;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
    };
  };
};

function resolvePayerEmail(userId: string) {
  const email = config.mercadoPagoPayerEmail?.trim() || `comprador-${userId}@example.com`;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(`MERCADO_PAGO_PAYER_EMAIL inválido: ${email}`);
  }

  return email;
}

function resolveBaseUrl(): URL | undefined {
  if (!config.publicBaseUrl) return undefined;

  let baseUrl: URL;

  try {
    baseUrl = new URL(config.publicBaseUrl);
  } catch {
    throw new Error(`PUBLIC_BASE_URL inválida: ${config.publicBaseUrl}`);
  }

  if (baseUrl.protocol !== 'https:') {
    throw new Error('PUBLIC_BASE_URL precisa começar com https://. O Mercado Pago recusa webhooks/checkouts HTTP.');
  }

  return baseUrl;
}

function resolveNotificationUrl() {
  const baseUrl = resolveBaseUrl();
  return baseUrl ? `${baseUrl.origin}/webhooks/mercado-pago` : undefined;
}

function resolveRedirectUri(): string | undefined {
  const baseUrl = resolveBaseUrl();
  return baseUrl ? `${baseUrl.origin}/mercadopago/callback` : undefined;
}

// ── Resolução de credenciais por servidor (com fallback pro token global legado) ──────────────

type ResolvedCredentials = { accessToken: string; isConnected: boolean };

/**
 * Retorna o Access Token a usar para as chamadas desse servidor: a conta Mercado Pago que o
 * dono conectou via /mercadopago conectar (renovando sozinho se estiver perto de vencer), ou,
 * se o servidor ainda não conectou nada, o MERCADO_PAGO_ACCESS_TOKEN global (comportamento
 * anterior, mantido por compatibilidade). `isConnected` diz se é uma conta conectada (elegível
 * pra split de comissão) ou o token global (não é — o dinheiro já é todo do dono do bot).
 */
async function resolveAccessToken(guildId: string): Promise<ResolvedCredentials> {
  const connection = await getMercadoPagoConnection(guildId);

  if (!connection) {
    if (!config.mercadoPagoAccessToken) {
      throw new Error(
        'Este servidor ainda não conectou uma conta Mercado Pago. Peça para o dono do servidor rodar /mercadopago conectar.'
      );
    }
    return { accessToken: config.mercadoPagoAccessToken, isConnected: false };
  }

  const expiresInMs = new Date(connection.expiresAt).getTime() - Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (expiresInMs <= oneDayMs) {
    try {
      const refreshed = await refreshConnection(connection);
      return { accessToken: refreshed.accessToken, isConnected: true };
    } catch (error) {
      console.error(`Falha ao renovar automaticamente a conexão Mercado Pago do servidor ${guildId}:`, describeError(error));
      // Se ainda não venceu de fato, tenta usar o token atual mesmo assim; se já venceu, propaga o erro.
      if (expiresInMs > 0) return { accessToken: connection.accessToken, isConnected: true };
      throw new Error(
        'A conexão com o Mercado Pago deste servidor expirou e não foi possível renovar automaticamente. Peça para o dono rodar /mercadopago conectar de novo.'
      );
    }
  }

  return { accessToken: connection.accessToken, isConnected: true };
}

/** Calcula o valor (em R$) da comissão da plataforma sobre um preço, arredondado a 2 casas. */
async function calculatePlatformFee(price: number, isConnected: boolean): Promise<number | undefined> {
  if (!isConnected) return undefined; // token global: dinheiro já é todo do dono do bot, sem split

  const percent = await getCommissionPercent();
  if (percent <= 0) return undefined;

  const fee = Math.round(price * percent) / 100;
  return fee > 0 ? fee : undefined;
}

function buildClients(accessToken: string) {
  const mpConfig = new MercadoPagoConfig({ accessToken });
  return { payment: new Payment(mpConfig), preference: new Preference(mpConfig), oauth: new OAuth(mpConfig) };
}

// ── OAuth: conectar a conta Mercado Pago de um servidor ───────────────────────────────────────

export function isOAuthConfigured(): boolean {
  return Boolean(config.mercadoPagoClientId && config.mercadoPagoClientSecret);
}

/** Monta a URL que o dono do servidor deve abrir para autorizar o bot a operar em nome da conta dele. */
export function buildAuthorizationUrl(state: string): string {
  const redirectUri = resolveRedirectUri();

  if (!config.mercadoPagoClientId || !redirectUri) {
    throw new Error('MERCADO_PAGO_CLIENT_ID e/ou PUBLIC_BASE_URL não configurados — não é possível gerar o link de conexão.');
  }

  const { oauth } = buildClients(config.mercadoPagoAccessToken || 'unused');

  return oauth.getAuthorizationURL({
    options: {
      client_id: config.mercadoPagoClientId,
      redirect_uri: redirectUri,
      state
    }
  });
}

type OAuthTokenResult = {
  accessToken: string;
  refreshToken: string;
  mpUserId?: string;
  publicKey?: string;
  expiresAt: string;
};

/** Troca o código de autorização (válido por só 10 minutos) pelos tokens da conta conectada. */
export async function exchangeAuthorizationCode(code: string, guildId: string, connectedBy: string): Promise<OAuthTokenResult> {
  const redirectUri = resolveRedirectUri();

  if (!config.mercadoPagoClientId || !config.mercadoPagoClientSecret || !redirectUri) {
    throw new Error('MERCADO_PAGO_CLIENT_ID, MERCADO_PAGO_CLIENT_SECRET e PUBLIC_BASE_URL precisam estar configurados.');
  }

  const { oauth } = buildClients(config.mercadoPagoAccessToken || 'unused');

  try {
    const response = await oauth.create({
      body: {
        client_secret: config.mercadoPagoClientSecret,
        client_id: config.mercadoPagoClientId,
        code,
        redirect_uri: redirectUri
      }
    });

    const result: OAuthTokenResult = {
      accessToken: response.access_token as string,
      refreshToken: response.refresh_token as string,
      mpUserId: response.user_id ? String(response.user_id) : undefined,
      publicKey: response.public_key ?? undefined,
      expiresAt: new Date(Date.now() + Number(response.expires_in ?? 15_552_000) * 1000).toISOString()
    };

    await saveMercadoPagoConnection({
      guildId,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      mpUserId: result.mpUserId,
      publicKey: result.publicKey,
      connectedBy,
      expiresAt: result.expiresAt
    });

    return result;
  } catch (error) {
    console.error(`Falha ao trocar código de autorização por token (servidor ${guildId}):`, describeError(error));
    throw new Error(`Mercado Pago recusou a conexão: ${describeError(error)}`);
  }
}

/** Renova uma conexão existente usando o refresh_token, salvando o novo par de tokens. */
export async function refreshConnection(connection: MercadoPagoConnection): Promise<OAuthTokenResult> {
  if (!config.mercadoPagoClientId || !config.mercadoPagoClientSecret) {
    throw new Error('MERCADO_PAGO_CLIENT_ID e MERCADO_PAGO_CLIENT_SECRET precisam estar configurados para renovar conexões.');
  }

  const { oauth } = buildClients(connection.accessToken);

  const response = await oauth.refresh({
    body: {
      client_secret: config.mercadoPagoClientSecret,
      client_id: config.mercadoPagoClientId,
      refresh_token: connection.refreshToken
    }
  });

  const result: OAuthTokenResult = {
    accessToken: response.access_token as string,
    refreshToken: (response.refresh_token as string) ?? connection.refreshToken,
    mpUserId: response.user_id ? String(response.user_id) : connection.mpUserId,
    publicKey: response.public_key ?? connection.publicKey,
    expiresAt: new Date(Date.now() + Number(response.expires_in ?? 15_552_000) * 1000).toISOString()
  };

  await saveMercadoPagoConnection({
    guildId: connection.guildId,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    mpUserId: result.mpUserId,
    publicKey: result.publicKey,
    connectedBy: connection.connectedBy,
    expiresAt: result.expiresAt
  });

  return result;
}

// ── Pagamentos ──────────────────────────────────────────────────────────────────────────────

export async function createPixPayment(order: Order) {
  if (!order.guildId) throw new Error('Pedido sem guildId — não é possível determinar as credenciais do Mercado Pago.');

  const { accessToken, isConnected } = await resolveAccessToken(order.guildId);
  const { payment: paymentClient } = buildClients(accessToken);
  const notificationUrl = resolveNotificationUrl();
  const applicationFee = await calculatePlatformFee(order.product.price, isConnected);

  try {
    const response = (await paymentClient.create({
      body: {
        transaction_amount: order.product.price,
        description: `${order.product.name} - Pedido ${order.id}`,
        payment_method_id: 'pix',
        external_reference: order.id,
        notification_url: notificationUrl,
        date_of_expiration: new Date(Date.now() + ORDER_EXPIRATION_MINUTES * 60_000).toISOString(),
        ...(applicationFee !== undefined ? { application_fee: applicationFee } : {}),
        payer: {
          email: resolvePayerEmail(order.userId),
          first_name: 'Cliente',
          last_name: 'Discord'
        }
      }
    })) as PixPaymentResponse;

    const transactionData = response.point_of_interaction?.transaction_data;

    return {
      paymentId: response.id?.toString(),
      qrCode: transactionData?.qr_code,
      qrCodeBase64: transactionData?.qr_code_base64
    };
  } catch (error) {
    console.error(`Mercado Pago recusou a criação do PIX do pedido ${order.id}: ${describeError(error)}`);
    throw new Error(`Mercado Pago recusou a criação do PIX: ${describeError(error)}`);
  }
}

/**
 * Gera um link de pagamento hospedado pelo Mercado Pago (Checkout Pro) para cartão de
 * crédito/débito. O comprador digita os dados do cartão numa página segura do próprio
 * Mercado Pago — o bot nunca vê nem manipula número de cartão, CVV, etc.
 */
export async function createCardCheckoutLink(order: Order): Promise<{ checkoutUrl?: string }> {
  if (!order.guildId) throw new Error('Pedido sem guildId — não é possível determinar as credenciais do Mercado Pago.');

  const { accessToken, isConnected } = await resolveAccessToken(order.guildId);
  const { preference: preferenceClient } = buildClients(accessToken);
  const baseUrl = resolveBaseUrl();
  const notificationUrl = resolveNotificationUrl();
  const marketplaceFee = await calculatePlatformFee(order.product.price, isConnected);

  try {
    const response = await preferenceClient.create({
      body: {
        items: [
          {
            id: String(order.product.id),
            title: order.product.name,
            description: order.product.description.slice(0, 250),
            quantity: 1,
            currency_id: config.currency,
            unit_price: order.product.price
          }
        ],
        external_reference: order.id,
        notification_url: notificationUrl,
        ...(marketplaceFee !== undefined ? { marketplace_fee: marketplaceFee } : {}),
        payment_methods: {
          excluded_payment_types: [{ id: 'ticket' }, { id: 'bank_transfer' }, { id: 'atm' }]
        },
        ...(baseUrl
          ? {
              back_urls: {
                success: `${baseUrl.origin}/checkout/return?status=success`,
                pending: `${baseUrl.origin}/checkout/return?status=pending`,
                failure: `${baseUrl.origin}/checkout/return?status=failure`
              },
              auto_return: 'approved' as const
            }
          : {})
      }
    });

    return { checkoutUrl: response.init_point ?? response.sandbox_init_point ?? undefined };
  } catch (error) {
    console.error(`Mercado Pago recusou a criação do checkout de cartão do pedido ${order.id}: ${describeError(error)}`);
    throw new Error(`Mercado Pago recusou a criação do checkout de cartão: ${describeError(error)}`);
  }
}

export async function getPaymentDetails(
  paymentId: string,
  guildId: string
): Promise<{ status?: string; externalReference?: string }> {
  try {
    const { accessToken } = await resolveAccessToken(guildId);
    const { payment: paymentClient } = buildClients(accessToken);
    const response = await paymentClient.get({ id: paymentId });
    return { status: response.status, externalReference: response.external_reference ?? undefined };
  } catch (error) {
    console.error(`Falha ao consultar pagamento ${paymentId} no Mercado Pago (servidor ${guildId}):`, describeError(error));
    return {};
  }
}

/**
 * Busca um pagamento pelo external_reference (ID do nosso pedido). Necessário para o checkout de
 * cartão, já que só descobrimos o ID do pagamento da Mercado Pago depois que o comprador termina
 * o checkout (diferente do PIX, que já retorna o ID na hora de criar).
 */
export async function searchPaymentByExternalReference(
  orderId: string,
  guildId: string
): Promise<{ id: string; status?: string } | undefined> {
  try {
    const { accessToken } = await resolveAccessToken(guildId);
    const { payment: paymentClient } = buildClients(accessToken);
    const response = await paymentClient.search({ options: { external_reference: orderId, sort: 'date_created', criteria: 'desc' } });
    const first = response.results?.[0];
    if (!first?.id) return undefined;
    return { id: String(first.id), status: first.status };
  } catch (error) {
    console.error(`Falha ao buscar pagamento pelo external_reference ${orderId} (servidor ${guildId}):`, describeError(error));
    return undefined;
  }
}

/**
 * Resolve o status atual de pagamento de um pedido, funcionando tanto para PIX (paymentId já
 * conhecido) quanto para cartão (paymentId só existe depois que o comprador termina o checkout).
 */
export async function resolveOrderPaymentStatus(order: Order): Promise<{ status?: string; paymentId?: string }> {
  if (!order.guildId) return {};

  if (order.paymentId) {
    const details = await getPaymentDetails(order.paymentId, order.guildId);
    return { status: details.status, paymentId: order.paymentId };
  }

  const found = await searchPaymentByExternalReference(order.id, order.guildId);
  return found ? { status: found.status, paymentId: found.id } : {};
}
