import { query } from './db.js';
import { decryptSecret, encryptSecret } from './tokenCrypto.js';

export type MercadoPagoConnection = {
  guildId: string;
  accessToken: string;
  refreshToken: string;
  mpUserId?: string;
  publicKey?: string;
  connectedBy?: string;
  expiresAt: string;
  updatedAt: string;
};

type ConnectionRow = {
  guild_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  mp_user_id: string | null;
  public_key: string | null;
  connected_by: string | null;
  expires_at: string;
  updated_at: string;
};

function mapRow(row: ConnectionRow): MercadoPagoConnection {
  return {
    guildId: row.guild_id,
    accessToken: decryptSecret(row.access_token_encrypted),
    refreshToken: decryptSecret(row.refresh_token_encrypted),
    mpUserId: row.mp_user_id ?? undefined,
    publicKey: row.public_key ?? undefined,
    connectedBy: row.connected_by ?? undefined,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at
  };
}

export async function getMercadoPagoConnection(guildId: string): Promise<MercadoPagoConnection | undefined> {
  const rows = await query<ConnectionRow>('SELECT * FROM guild_mp_connections WHERE guild_id = $1', [guildId]);
  return rows[0] ? mapRow(rows[0]) : undefined;
}

export async function findConnectionByMpUserId(mpUserId: string): Promise<MercadoPagoConnection | undefined> {
  const rows = await query<ConnectionRow>('SELECT * FROM guild_mp_connections WHERE mp_user_id = $1', [mpUserId]);
  return rows[0] ? mapRow(rows[0]) : undefined;
}

export async function saveMercadoPagoConnection(input: {
  guildId: string;
  accessToken: string;
  refreshToken: string;
  mpUserId?: string;
  publicKey?: string;
  connectedBy?: string;
  expiresAt: string;
}): Promise<MercadoPagoConnection> {
  const rows = await query<ConnectionRow>(
    `INSERT INTO guild_mp_connections (guild_id, access_token_encrypted, refresh_token_encrypted, mp_user_id, public_key, connected_by, expires_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (guild_id) DO UPDATE SET
       access_token_encrypted = EXCLUDED.access_token_encrypted,
       refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
       mp_user_id = EXCLUDED.mp_user_id,
       public_key = EXCLUDED.public_key,
       connected_by = EXCLUDED.connected_by,
       expires_at = EXCLUDED.expires_at,
       updated_at = now()
     RETURNING *`,
    [
      input.guildId,
      encryptSecret(input.accessToken),
      encryptSecret(input.refreshToken),
      input.mpUserId ?? null,
      input.publicKey ?? null,
      input.connectedBy ?? null,
      input.expiresAt
    ]
  );
  return mapRow(rows[0]);
}

export async function deleteMercadoPagoConnection(guildId: string): Promise<boolean> {
  const rows = await query('DELETE FROM guild_mp_connections WHERE guild_id = $1 RETURNING guild_id', [guildId]);
  return rows.length > 0;
}

/** Conexões que vencem dentro de `daysThreshold` dias — usado pelo job de renovação/alerta. */
export async function listConnectionsExpiringSoon(daysThreshold: number): Promise<MercadoPagoConnection[]> {
  const rows = await query<ConnectionRow>(
    `SELECT * FROM guild_mp_connections WHERE expires_at <= now() + ($1 || ' days')::interval`,
    [daysThreshold]
  );
  return rows.map(mapRow);
}
