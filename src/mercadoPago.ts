import { MercadoPagoConfig, Payment, Preference } from 'mercadopago';
import { config } from './config.js';
import { describeError } from './errors.js';
import { ORDER_EXPIRATION_MINUTES, type Order } from './store.js';

const client = new MercadoPagoConfig({ accessToken: config.mercadoPagoAccessToken });
const paymentClient = new Payment(client);
const preferenceClient = new Preference(client);

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

export async function createPixPayment(order: Order) {
  const notificationUrl = resolveNotificationUrl();

  try {
    const response = (await paymentClient.create({
      body: {
        transaction_amount: order.product.price,
        description: `${order.product.name} - Pedido ${order.id}`,
        payment_method_id: 'pix',
        external_reference: order.id,
        notification_url: notificationUrl,
        date_of_expiration: new Date(Date.now() + ORDER_EXPIRATION_MINUTES * 60_000).toISOString(),
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
  const baseUrl = resolveBaseUrl();
  const notificationUrl = resolveNotificationUrl();

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
        payer: {
          email: resolvePayerEmail(order.userId)
        },
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

export async function getPaymentDetails(paymentId: string): Promise<{ status?: string; externalReference?: string }> {
  try {
    const response = await paymentClient.get({ id: paymentId });
    return { status: response.status, externalReference: response.external_reference ?? undefined };
  } catch (error) {
    console.error(`Falha ao consultar pagamento ${paymentId} no Mercado Pago:`, describeError(error));
    return {};
  }
}

export async function getPaymentStatus(paymentId: string) {
  const details = await getPaymentDetails(paymentId);
  return details.status;
}

/**
 * Busca um pagamento pelo external_reference (ID do nosso pedido). Necessário para o checkout de
 * cartão, já que só descobrimos o ID do pagamento da Mercado Pago depois que o comprador termina
 * o checkout (diferente do PIX, que já retorna o ID na hora de criar).
 */
export async function searchPaymentByExternalReference(orderId: string): Promise<{ id: string; status?: string } | undefined> {
  try {
    const response = await paymentClient.search({ options: { external_reference: orderId, sort: 'date_created', criteria: 'desc' } });
    const first = response.results?.[0];
    if (!first?.id) return undefined;
    return { id: String(first.id), status: first.status };
  } catch (error) {
    console.error(`Falha ao buscar pagamento pelo external_reference ${orderId}:`, describeError(error));
    return undefined;
  }
}

/**
 * Resolve o status atual de pagamento de um pedido, funcionando tanto para PIX (paymentId já
 * conhecido) quanto para cartão (paymentId só existe depois que o comprador termina o checkout).
 */
export async function resolveOrderPaymentStatus(order: Order): Promise<{ status?: string; paymentId?: string }> {
  if (order.paymentId) {
    const details = await getPaymentDetails(order.paymentId);
    return { status: details.status, paymentId: order.paymentId };
  }

  const found = await searchPaymentByExternalReference(order.id);
  return found ? { status: found.status, paymentId: found.id } : {};
}
