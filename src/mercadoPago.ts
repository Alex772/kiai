import { MercadoPagoConfig, Payment } from 'mercadopago';
import { config } from './config.js';
import { describeError } from './errors.js';
import type { Order } from './store.js';

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

export async function createPixPayment(order: Order) {
  const notificationUrl = config.publicBaseUrl
    ? `${config.publicBaseUrl.replace(/\/$/, '')}/webhooks/mercado-pago`
    : undefined;

  try {
    const response = (await paymentClient.create({
      body: {
        transaction_amount: order.product.price,
        description: `${order.product.name} - Pedido ${order.id}`,
        payment_method_id: 'pix',
        external_reference: order.id,
        notification_url: notificationUrl,
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
