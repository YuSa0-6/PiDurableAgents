// A secret set with `wrangler secret put API_TOKEN --name d1agents-pi-durable`.
// It is not in cloudflare.config.ts, so the types cf generates do not include it.
interface Env {
  /**
   * Bearer token every /api/* request except /api/health must carry.
   * Optional: until it is set, the API is open.
   */
  readonly API_TOKEN?: string;
}
