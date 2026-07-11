import { createHmac, timingSafeEqual } from 'node:crypto';

type VerifyParams = {
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string | undefined;
  secret: string;
};

/**
 * Valida a assinatura HMAC-SHA256 enviada pelo Mercado Pago no header `x-signature`,
 * conforme documentação oficial:
 * https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications
 *
 * Formato do header: "ts=<timestamp>,v1=<hash hex>"
 * Manifesto assinado: "id:<data.id em minúsculas>;request-id:<x-request-id>;ts:<ts>;"
 */
export function verifyMercadoPagoSignature({ xSignature, xRequestId, dataId, secret }: VerifyParams): boolean {
  if (!xSignature) return false;

  let ts: string | undefined;
  let hash: string | undefined;

  for (const part of xSignature.split(',')) {
    const [rawKey, rawValue] = part.split('=');
    if (!rawKey || rawValue === undefined) continue;
    const key = rawKey.trim();
    const value = rawValue.trim();
    if (key === 'ts') ts = value;
    if (key === 'v1') hash = value;
  }

  if (!ts || !hash) return false;

  const manifestParts: string[] = [];
  if (dataId) manifestParts.push(`id:${dataId.toLowerCase()}`);
  if (xRequestId) manifestParts.push(`request-id:${xRequestId}`);
  manifestParts.push(`ts:${ts}`);
  const manifest = `${manifestParts.join(';')};`;

  const expectedHex = createHmac('sha256', secret).update(manifest).digest('hex');

  const expectedBuffer = Buffer.from(expectedHex, 'hex');
  const receivedBuffer = Buffer.from(hash, 'hex');

  if (expectedBuffer.length === 0 || expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
