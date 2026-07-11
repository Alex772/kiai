import { MercadoPagoConfig, Payment } from 'mercadopago';
import { config } from './config.js';
import { describeError } from './errors.js';
import { ORDER_EXPIRATION_MINUTES, type Order } from './store.js';

const client = new MercadoPagoConfig({ accessToken: config.mercadoPagoAccessToken });
const paymentClient = new Payment(client);

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

function resolveNotificationUrl() {
  if (!config.publicBaseUrl) return undefined;

  let baseUrl: URL;

  try {
    baseUrl = new URL(config.publicBaseUrl);
  } catch {
    throw new Error(`PUBLIC_BASE_URL inválida: ${config.publicBaseUrl}`);
  }

  if (baseUrl.protocol !== 'https:') {
    throw new Error('PUBLIC_BASE_URL precisa começar com https://. O Mercado Pago recusa webhooks HTTP ao criar PIX.');
  }

  return `${baseUrl.origin}/webhooks/mercado-pago`;
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

export async function getPaymentStatus(paymentId: string) {
  const response = await paymentClient.get({ id: paymentId });
  return response.status;
}
