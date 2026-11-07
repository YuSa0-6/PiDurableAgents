/**
 * GitHub App authentication: sign a JWT with the App's private key, trade it
 * for an installation access token scoped to one repository, and cache that
 * token until shortly before it expires.
 *
 * The private key and the tokens stay in this module and the tools that call
 * it. Nothing here is returned to the model.
 */

export type Fetch = (input: Request | string | URL, init?: RequestInit) => Promise<Response>;

export type GitHubAppConfig = {
  readonly appId: string;
  readonly installationId: string;
  /** PEM. GitHub's download is PKCS#1 (`BEGIN RSA PRIVATE KEY`); PKCS#8 also works. */
  readonly privateKey: string;
};

/** `owner/name`, as GitHub writes it. */
export type RepoRef = { readonly owner: string; readonly name: string };

export const GITHUB_API = "https://api.github.com";

/** What every installation token may do: push branches and open pull requests. */
const TOKEN_PERMISSIONS = { contents: "write", pull_requests: "write" } as const;

/** Refresh a cached token this long before GitHub expires it. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function githubHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "d1agents"
  };
}

/** HTTP headers for git over HTTPS: GitHub wants Basic `x-access-token:<token>`. */
export function gitHeaders(token: string): Record<string, string> {
  return { authorization: `Basic ${btoa(`x-access-token:${token}`)}` };
}

export class GitHubApp {
  readonly #config: GitHubAppConfig;
  readonly #fetch: Fetch;
  readonly #now: () => number;
  #key?: Promise<CryptoKey>;
  readonly #tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(config: GitHubAppConfig, fetchImpl: Fetch = fetch, now: () => number = Date.now) {
    this.#config = config;
    this.#fetch = fetchImpl;
    this.#now = now;
  }

  /** An installation token that can push to and open pull requests on `repo` only. */
  async token(repo: RepoRef): Promise<string> {
    const cacheKey = `${repo.owner}/${repo.name}`.toLowerCase();
    const cached = this.#tokens.get(cacheKey);
    if (cached && cached.expiresAt - REFRESH_MARGIN_MS > this.#now()) return cached.token;

    const response = await this.#fetch(
      `${GITHUB_API}/app/installations/${this.#config.installationId}/access_tokens`,
      {
        method: "POST",
        headers: { ...githubHeaders(await this.jwt()), "content-type": "application/json" },
        body: JSON.stringify({ repositories: [repo.name], permissions: TOKEN_PERMISSIONS })
      }
    );
    if (!response.ok) {
      throw new Error(
        `GitHub refused an installation token for ${cacheKey} (HTTP ${response.status}). ` +
          "Check that the App is installed on this repository with Contents and Pull requests write access."
      );
    }
    const body = (await response.json()) as { token: string; expires_at: string };
    this.#tokens.set(cacheKey, { token: body.token, expiresAt: Date.parse(body.expires_at) });
    return body.token;
  }

  /** The App's JWT: RS256, issued a minute ago against clock drift, valid for 9 minutes. */
  async jwt(): Promise<string> {
    const now = Math.floor(this.#now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(
      JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: this.#config.appId })
    );
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      await this.#signingKey(),
      new TextEncoder().encode(`${header}.${payload}`)
    );
    return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
  }

  #signingKey(): Promise<CryptoKey> {
    this.#key ??= importPrivateKey(this.#config.privateKey);
    return this.#key;
  }
}

/** Import a PEM RSA private key, PKCS#1 or PKCS#8, for RS256 signing. */
export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // A key set through an env var sometimes keeps `\n` escapes.
  const text = pem.replaceAll("\\n", "\n");
  const pkcs1 = text.includes("BEGIN RSA PRIVATE KEY");
  const body = text.replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, "");
  if (body.length === 0) throw new Error("The GitHub App private key is empty");
  const der: Uint8Array<ArrayBuffer> = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    pkcs1 ? pkcs1ToPkcs8(der) : der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/**
 * Wrap a PKCS#1 RSAPrivateKey in a PKCS#8 PrivateKeyInfo, which is the only
 * private key format Web Crypto imports:
 *
 *   SEQUENCE { INTEGER 0, SEQUENCE { OID rsaEncryption, NULL }, OCTET STRING { pkcs1 } }
 */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const version = [0x02, 0x01, 0x00];
  const rsaEncryption = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00
  ];
  const octetString = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const content = [...version, ...rsaEncryption, ...octetString];
  return Uint8Array.from([0x30, ...derLength(content.length), ...content]);
}

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let n = length; n > 0; n >>= 8) bytes.unshift(n & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
