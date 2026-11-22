import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Registered OAuth clients (MCP hosts such as ChatGPT or Claude desktop-app
 * connectors). Clients register dynamically and never see a student's data
 * until that student explicitly approves the connection.
 */
export const oauthClients = pgTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  clientSecretHash: text("client_secret_hash"),
  clientName: text("client_name").notNull(),
  redirectUris: jsonb("redirect_uris").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A pending or completed consent attempt. The browser session that approves
 * the request must be signed in as the student being granted access.
 */
export const oauthAuthorizations = pgTable(
  "oauth_authorizations",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    userId: text("user_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    scope: text("scope").notNull(),
    state: text("state"),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
    codeHash: text("code_hash"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("oauth_authorizations_user_idx").on(table.userId)],
);

/**
 * Access and refresh tokens. Only SHA-256 hashes are stored so a database
 * leak cannot be replayed against the MCP server.
 */
export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    kind: text("kind").notNull(),
    clientId: text("client_id").notNull(),
    userId: text("user_id").notNull(),
    connectionId: text("connection_id").notNull(),
    scope: text("scope").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("oauth_tokens_hash_idx").on(table.tokenHash)],
);

/**
 * A student-visible connection. Disconnecting sets revokedAt and revokes every
 * token issued under it, so a connected assistant loses access immediately.
 */
export const aiConnections = pgTable(
  "ai_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    clientId: text("client_id").notNull(),
    clientName: text("client_name").notNull(),
    scope: text("scope").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("ai_connections_user_idx").on(table.userId)],
);

/**
 * Destructive requests an assistant has asked for. Nothing is deleted until
 * the student approves the request in Productivio's own interface.
 */
export const pendingDeletions = pgTable(
  "pending_deletions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    connectionId: text("connection_id").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    targetTitle: text("target_title").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
  },
  (table) => [index("pending_deletions_user_idx").on(table.userId, table.status)],
);
