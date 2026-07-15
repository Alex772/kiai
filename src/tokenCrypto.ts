import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Criptografia simétrica (AES-256-GCM) para guardar tokens sensíveis (do Mercado Pago de cada
 * servidor) no banco de dados. A chave vem de TOKEN_ENCRYPTION_KEY — qualquer string funciona
 * como "senha mestra", ela é normalizada via SHA-256 pra virar uma chave de 32 bytes válida.
 *
 * Formato armazenado: "<iv em base64>.<authTag em base64>.<dados cifrados em base64>"
 */

function getKey(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY não configurada. Defina essa variável no Railway antes de conectar contas Mercado Pago (ex: gere com `openssl rand -hex 32`).'
    );
  }
  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Payload criptografado em formato inválido.');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function isTokenEncryptionConfigured(): boolean {
  return Boolean(process.env.TOKEN_ENCRYPTION_KEY?.trim());
}
