const OWNER_KEY = /^[a-f0-9]{64}$/;

export function isOwnerKey(value: string): boolean {
  return OWNER_KEY.test(value);
}

/** 32 random bytes, hex. This is the capability for one browser's archive. */
export function createOwnerKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function readOwnerKeyHeader(getHeader: (name: string) => string | undefined | null): string | null {
  const direct = getHeader("x-owner-key")?.trim().toLowerCase() ?? "";
  if (isOwnerKey(direct)) return direct;
  const authorization = getHeader("authorization")?.trim() ?? "";
  const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(authorization);
  const bearer = match?.[1]?.toLowerCase() ?? "";
  return isOwnerKey(bearer) ? bearer : null;
}

/** SHA-256 hex of the owner key. The database stores this, never the key itself. */
export async function ownerIdForKey(key: string): Promise<string> {
  if (!isOwnerKey(key)) throw new Error("Owner key is not valid.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const bytes = new Uint8Array(digest);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
