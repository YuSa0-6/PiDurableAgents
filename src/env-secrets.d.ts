// Secrets set with `wrangler secret put`, which `wrangler types` does not see.
// Both are optional: the API is open and the GitHub tools are off until they are set.
interface Env {
  /** Bearer token every /api/* request except /api/health must carry. */
  readonly API_TOKEN?: string;
  /** The GitHub App's private key (PEM, PKCS#1 as GitHub downloads it, or PKCS#8). */
  readonly GITHUB_APP_PRIVATE_KEY?: string;
}
