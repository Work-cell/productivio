import { Router, type IRouter, type Request } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { aiConnections, db, oauthAuthorizations, oauthClients, oauthTokens } from "@workspace/db";
import {
  ACCESS_TOKEN_TTL_MS,
  AUTH_CODE_TTL_MS,
  AUTHORIZATION_REQUEST_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  hashSecret,
  randomId,
  randomToken,
  revokeConnectionTokens,
  safeEqual,
  verifyPkce,
} from "../lib/oauth";
import { logger } from "../lib/logger";

export const SUPPORTED_SCOPES = ["planner:read", "planner:write", "planner:delete"];
export const MCP_RESOURCE = "/mcp";

const router: IRouter = Router();

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const isSafeRedirectUri = (value: string) => {
  try {
    const url = new URL(value);
    if (url.hash) return false;
    // Loopback HTTP is allowed for native and desktop MCP clients.
    return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost"));
  } catch {
    return false;
  }
};

const requestedScopes = (raw: unknown): string[] => {
  const wanted = typeof raw === "string" ? raw.split(/[\s+]+/).filter(Boolean) : [];
  if (!wanted.length) return SUPPORTED_SCOPES;
  // Never widen beyond what this server implements.
  return wanted.filter((scope, index) => SUPPORTED_SCOPES.includes(scope) && wanted.indexOf(scope) === index);
};

export function publicBaseUrl(req: Request) {
  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");

  const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.header("x-forwarded-host")?.split(",")[0]?.trim();
  const proto = forwardedProto || req.protocol || "https";
  const host = forwardedHost || req.header("host");
  const base = host ? `${proto}://${host}` : "http://localhost";
  return configured || base;
}

/** RFC 9728 protected-resource metadata, so hosts know an MCP endpoint needs auth. */
router.get("/.well-known/oauth-protected-resource", (req, res) => {
  const base = publicBaseUrl(req);
  res.json({
    resource: `${base}${MCP_RESOURCE}`,
    authorization_servers: [base],
    scopes_supported: SUPPORTED_SCOPES,
    bearer_methods_supported: ["header"],
  });
});

router.get("/.well-known/oauth-protected-resource/mcp", (req, res) => {
  const base = publicBaseUrl(req);
  res.json({
    resource: `${base}${MCP_RESOURCE}`,
    authorization_servers: [base],
    scopes_supported: SUPPORTED_SCOPES,
    bearer_methods_supported: ["header"],
  });
});

/** RFC 8414 authorization-server metadata, including the dynamic client endpoint. */
router.get("/.well-known/oauth-authorization-server", (req, res) => {
  const base = publicBaseUrl(req);
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: SUPPORTED_SCOPES,
    client_id_metadata_document_supported: false,
  });
});

/** Dynamic client registration (RFC 7591) for hosts that do not pre-register. */
router.post("/oauth/register", async (req, res) => {
  const body = req.body as Record<string, unknown> | undefined;
  const clientName = typeof body?.client_name === "string" && body.client_name.trim()
    ? body.client_name.trim().slice(0, 120)
    : "Connected AI assistant";
  const redirectUris = asStringArray(body?.redirect_uris);
  if (!redirectUris.length || redirectUris.length > 10 || !redirectUris.every(uri => typeof uri === "string" && isSafeRedirectUri(uri))) {
    res.status(400).json({ error: "invalid_redirect_uri", error_description: "Provide 1–10 absolute https (or loopback http) redirect URIs without fragments." });
    return;
  }

  const method = body?.token_endpoint_auth_method === "client_secret_post" ? "client_secret_post" : "none";
  const clientId = randomId("client");
  const clientSecret = method === "client_secret_post" ? randomToken(32) : null;

  await db.insert(oauthClients).values({
    clientId,
    clientName,
    clientSecretHash: clientSecret ? hashSecret(clientSecret) : null,
    redirectUris,
  });

  logger.info({ clientId }, "Registered OAuth client for MCP access");
  res.status(201).json({
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: method,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: SUPPORTED_SCOPES.join(" "),
  });
});

/** Loads and validates an authorization request for the consent screen. */
async function loadAuthorizationRequest(id: string) {
  if (!id) return null;
  const [row] = await db.select().from(oauthAuthorizations).where(eq(oauthAuthorizations.id, id)).limit(1);
  if (!row || row.status !== "pending") return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

/** The consent screen fetches this so it can show the client name and scopes. */
router.get("/oauth/authorize", async (req, res) => {
  const request = await loadAuthorizationRequest(typeof req.query.request_id === "string" ? req.query.request_id : "");
  if (!request) {
    res.status(400).json({ error: "invalid_request", error_description: "This connection request is unknown or has expired. Start again from your AI assistant." });
    return;
  }
  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, request.clientId)).limit(1);
  res.json({
    requestId: request.id,
    clientName: client?.clientName ?? "Connected AI assistant",
    redirectUri: request.redirectUri,
    scopes: request.scope.split(" ").filter(Boolean),
    expiresAt: request.expiresAt,
  });
});

/**
 * The signed-in student approves the connection. The deciding factor is the
 * Clerk session, never a user id supplied by the AI client.
 */
router.post("/oauth/authorize", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "sign_in_required", error_description: "Sign in to Productivio before approving a connection." });
    return;
  }

  const body = req.body as Record<string, unknown> | undefined;
  const request = await loadAuthorizationRequest(typeof body?.request_id === "string" ? body.request_id : "");
  if (!request) {
    res.status(400).json({ error: "invalid_request", error_description: "This connection request is unknown or has expired." });
    return;
  }
  if (body?.decision !== "approve") {
    await db.update(oauthAuthorizations).set({ status: "denied" }).where(eq(oauthAuthorizations.id, request.id));
    const denied = new URL(request.redirectUri);
    denied.searchParams.set("error", "access_denied");
    if (request.state) denied.searchParams.set("state", request.state);
    res.json({ outcome: "denied", redirectTo: denied.toString() });
    return;
  }

  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, request.clientId)).limit(1);
  if (!client) {
    res.status(400).json({ error: "invalid_client", error_description: "This AI assistant is no longer registered." });
    return;
  }

  const connectionId = randomId("conn");
  await db.insert(aiConnections).values({
    id: connectionId,
    userId,
    clientId: request.clientId,
    clientName: client.clientName,
    scope: request.scope,
  });

  const code = randomToken(32);
  await db
    .update(oauthAuthorizations)
    .set({ status: "approved", codeHash: hashSecret(code), userId, expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS) })
    .where(eq(oauthAuthorizations.id, request.id));

  const redirect = new URL(request.redirectUri);
  redirect.searchParams.set("code", code);
  if (request.state) redirect.searchParams.set("state", request.state);

  res.json({ outcome: "approved", redirectTo: redirect.toString(), connectionId });
});

/**
 * Authorization endpoint used by MCP hosts. It creates a short-lived request
 * and sends the browser to Productivio's consent screen inside the app.
 */
router.get("/oauth/start", async (req, res) => {
  const query = req.query as Record<string, unknown>;
  const clientId = typeof query.client_id === "string" ? query.client_id : "";
  const redirectUri = typeof query.redirect_uri === "string" ? query.redirect_uri : "";
  const responseType = typeof query.response_type === "string" ? query.response_type : "code";
  const codeChallenge = typeof query.code_challenge === "string" ? query.code_challenge : "";
  const codeChallengeMethod = typeof query.code_challenge_method === "string" ? query.code_challenge_method : "S256";

  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
  const redirectUris = (client?.redirectUris ?? []) as string[];

  if (!client || !redirectUris.includes(redirectUri)) {
    res.status(400).json({ error: "invalid_request", error_description: "Unknown client or a redirect URI that is not registered." });
    return;
  }
  if (responseType !== "code" || codeChallengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    res.status(400).json({ error: "invalid_request", error_description: "Only the authorization code flow with an S256 PKCE challenge is supported." });
    return;
  }

  const scopes = requestedScopes(query.scope);
  if (!scopes.length) {
    res.status(400).json({ error: "invalid_scope", error_description: "Request at least one supported scope." });
    return;
  }

  const id = randomId("authz");
  await db.insert(oauthAuthorizations).values({
    id,
    clientId,
    userId: "",
    redirectUri,
    scope: scopes.join(" "),
    state: typeof query.state === "string" ? query.state.slice(0, 500) : null,
    codeChallenge,
    codeChallengeMethod: "S256",
    expiresAt: new Date(Date.now() + AUTHORIZATION_REQUEST_TTL_MS),
  });

  const base = publicBaseUrl(req);
  res.redirect(`${base}/connect-ai?request=${encodeURIComponent(id)}`);
});

const clientCredentials = (req: Request) => {
  const basic = req.header("authorization");
  if (basic?.startsWith("Basic ")) {
    const [id, secret] = Buffer.from(basic.slice(6), "base64").toString("utf8").split(":");
    return { clientId: id, clientSecret: secret };
  }
  const body = req.body as Record<string, unknown> | undefined;
  return {
    clientId: typeof body?.client_id === "string" ? body.client_id : undefined,
    clientSecret: typeof body?.client_secret === "string" ? body.client_secret : undefined,
  };
};

async function issueTokens(connection: { id: string; userId: string; clientId: string; scope: string }) {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  const now = Date.now();
  await db.insert(oauthTokens).values([
    {
      id: randomId("tok"),
      tokenHash: hashSecret(accessToken),
      kind: "access",
      clientId: connection.clientId,
      userId: connection.userId,
      connectionId: connection.id,
      scope: connection.scope,
      expiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
    },
    {
      id: randomId("tok"),
      tokenHash: hashSecret(refreshToken),
      kind: "refresh",
      clientId: connection.clientId,
      userId: connection.userId,
      connectionId: connection.id,
      scope: connection.scope,
      expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
    },
  ]);
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: connection.scope,
  };
}

/** Token endpoint for authorization code and refresh grants. */
router.post("/oauth/token", async (req, res) => {
  const body = req.body as Record<string, unknown> | undefined;
  const grantType = typeof body?.grant_type === "string" ? body.grant_type : "";
  const { clientId, clientSecret } = clientCredentials(req);
  if (!clientId) {
    res.status(401).json({ error: "invalid_client" });
    return;
  }

  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
  if (!client) {
    res.status(401).json({ error: "invalid_client" });
    return;
  }
  if (client.clientSecretHash) {
    if (!clientSecret || !safeEqual(hashSecret(clientSecret), client.clientSecretHash)) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }
  }

  if (grantType === "authorization_code") {
    const code = typeof body?.code === "string" ? body.code : "";
    const codeHash = hashSecret(code);
    const [auth] = await db
      .select()
      .from(oauthAuthorizations)
      .where(and(eq(oauthAuthorizations.codeHash, codeHash), eq(oauthAuthorizations.clientId, clientId), eq(oauthAuthorizations.status, "approved")))
      .limit(1);

    if (!auth || auth.expiresAt.getTime() <= Date.now()) {
      res.status(400).json({ error: "invalid_grant", error_description: "This authorization code is invalid or has expired." });
      return;
    }
    const verifier = typeof body?.code_verifier === "string" ? body.code_verifier : "";
    if (!verifier || !verifyPkce(verifier, auth.codeChallenge)) {
      res.status(400).json({ error: "invalid_grant", error_description: "The PKCE verifier does not match this authorization code." });
      return;
    }

    // Single use: mark consumed before issuing tokens.
    await db.update(oauthAuthorizations).set({ status: "used", codeHash: null }).where(eq(oauthAuthorizations.id, auth.id));

    const [connection] = await db
      .select()
      .from(aiConnections)
      .where(and(eq(aiConnections.userId, auth.userId), eq(aiConnections.clientId, clientId), isNull(aiConnections.revokedAt)))
      .limit(1);
    if (!connection) {
      res.status(400).json({ error: "invalid_grant", error_description: "This connection was revoked." });
      return;
    }

    res.json(await issueTokens(connection));
    return;
  }

  if (grantType === "refresh_token") {
    const refreshToken = typeof body?.refresh_token === "string" ? body.refresh_token : "";
    const [row] = await db
      .select()
      .from(oauthTokens)
      .where(and(eq(oauthTokens.tokenHash, hashSecret(refreshToken)), eq(oauthTokens.kind, "refresh"), isNull(oauthTokens.revokedAt)))
      .limit(1);
    if (!row || row.clientId !== clientId || row.expiresAt.getTime() <= Date.now()) {
      res.status(400).json({ error: "invalid_grant", error_description: "This refresh token is invalid or has expired." });
      return;
    }
    const [connection] = await db
      .select()
      .from(aiConnections)
      .where(and(eq(aiConnections.id, row.connectionId), isNull(aiConnections.revokedAt)))
      .limit(1);
    if (!connection) {
      res.status(400).json({ error: "invalid_grant", error_description: "This connection was revoked." });
      return;
    }
    // Rotate the refresh token so a stolen copy stops working after one use.
    await db.update(oauthTokens).set({ revokedAt: new Date() }).where(eq(oauthTokens.id, row.id));
    res.json(await issueTokens(connection));
    return;
  }

  res.status(400).json({ error: "unsupported_grant_type" });
});

/** Disconnect from any client holding a token, and let students revoke access. */
router.post("/oauth/revoke", async (req, res) => {
  const body = req.body as Record<string, unknown> | undefined;
  const token = typeof body?.token === "string" ? body.token : "";
  if (token) {
    const [row] = await db.select().from(oauthTokens).where(eq(oauthTokens.tokenHash, hashSecret(token))).limit(1);
    if (row) {
      await db.update(aiConnections).set({ revokedAt: new Date() }).where(eq(aiConnections.id, row.connectionId));
      await revokeConnectionTokens(row.connectionId);
    }
  }
  // RFC 7009: unknown tokens still return success.
  res.status(200).json({ revoked: true });
});

export default router;
