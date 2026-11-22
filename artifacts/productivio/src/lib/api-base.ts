/**
 * Base URL for the Productivio API server.
 *
 * In development the Vite dev server proxies `/api`, `/oauth` and `/mcp` to the
 * API server, so a relative base works everywhere. Deployments that serve the
 * frontend and API from different hosts can set VITE_API_BASE_URL.
 */
export const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
