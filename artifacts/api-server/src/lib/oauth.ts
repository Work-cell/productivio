import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { aiConnections, db, oauthTokens } from "@workspace/db";

export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const AUTHORIZATION_REQUEST_TTL_MS = 30 * 60 * 1000;

/** Secrets are only ever stored as SHA-256 hashes. */
export const hashSecret = (value: string) => createHash("sha256").update(value).digest("hex");

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const randomId = (prefix: string) => `${prefix}_${randomBytes(16).toString("hex")}`;

export const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

/** RFC 7636 S256 verification for the authorization code flow. */
export const verifyPkce = (verifier: string, challenge: string) =>
  safeEqual(createHash("sha256").update(verifier).digest("base64url"), challenge);

export type AuthenticatedConnection = {
  userId: string;
  clientId: string;
  connectionId: string;
  scope: string;
};

/**
 * Resolves a bearer token to an active connection. Returns null for expired,
 * revoked, or unknown tokens so callers cannot accidentally treat a failed
 * lookup as anonymous access.
 */
export async function authenticateBearer(header: string | undefined): Promise<AuthenticatedConnection | null> {
  if (!header?.startsWith("Bearer ")) return null;
  const raw = header.slice("Bearer ".length).trim();
  if (!raw) return null;

  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.tokenHash, hashSecret(raw)), eq(oauthTokens.kind, "access"), isNull(oauthTokens.revokedAt)))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;

  const [connection] = await db
    .select()
    .from(aiConnections)
    .where(and(eq(aiConnections.id, row.connectionId), isNull(aiConnections.revokedAt)))
    .limit(1);

  if (!connection) return null;

  return {
    userId: connection.userId,
    clientId: connection.clientId,
    connectionId: connection.id,
    scope: connection.scope,
  };
}

export const hasScope = (scopes: string, required: string) =>
  scopes.split(/\s+/).filter(Boolean).includes(required);

export async function revokeConnectionTokens(connectionId: string) {
  await db
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthTokens.connectionId, connectionId), isNull(oauthTokens.revokedAt)));
}
