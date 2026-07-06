import { MercadoPagoConfig, Payment } from 'mercadopago';
import { config } from './config.js';
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

export async function createPixPayment(order: Order) {
  const notificationUrl = config.publicBaseUrl
    ? `${config.publicBaseUrl.replace(/\/$/, '')}/webhooks/mercado-pago`
    : undefined;

  const response = (await paymentClient.create({
    body: {
      transaction_amount: order.product.price,
      description: `${order.product.name} - Pedido ${order.id}`,
      payment_method_id: 'pix',
      external_reference: order.id,
      notification_url: notificationUrl,
      payer: {
        email: `${order.userId}@discord.local`,
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
}

export async function getPaymentStatus(paymentId: string) {
  const response = await paymentClient.get({ id: paymentId });
  return response.status;
}
