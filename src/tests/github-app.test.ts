import { describe, expect, it } from "vite-plus/test";
import { GitHubApp, importPrivateKey, type Fetch } from "../github/app";

/** A fresh RSA key pair, its private key as PKCS#8 and as PKCS#1 PEM. */
async function keyPair() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  return {
    publicKey: pair.publicKey,
    pkcs8: pem("PRIVATE KEY", pkcs8),
    pkcs1: pem("RSA PRIVATE KEY", innerPkcs1(pkcs8))
  };
}

function pem(label: string, der: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

/** The RSAPrivateKey inside a PKCS#8 PrivateKeyInfo: the content of its OCTET STRING. */
function innerPkcs1(der: Uint8Array): Uint8Array {
  let i = 0;
  const length = () => {
    const first = der[i++];
    if (first < 0x80) return first;
    let n = 0;
    for (let k = 0; k < (first & 0x7f); k++) n = (n << 8) | der[i++];
    return n;
  };
  i++; length(); // outer SEQUENCE
  i += 3; // INTEGER 0
  i++;
  const algorithm = length(); // AlgorithmIdentifier SEQUENCE: read its length, then skip it
  i += algorithm;
  i++; // OCTET STRING
  const size = length();
  return der.slice(i, i + size);
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(atob(part.replaceAll("-", "+").replaceAll("_", "/")));
}

async function verify(jwt: string, publicKey: CryptoKey): Promise<boolean> {
  const [header, payload, signature] = jwt.split(".");
  const sig = Uint8Array.from(atob(signature.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, sig, new TextEncoder().encode(`${header}.${payload}`));
}

describe("the GitHub App key", () => {
  it("imports PKCS#1, as GitHub downloads it, and PKCS#8", async () => {
    const { pkcs1, pkcs8 } = await keyPair();
    await expect(importPrivateKey(pkcs1)).resolves.toBeDefined();
    await expect(importPrivateKey(pkcs8)).resolves.toBeDefined();
    // As pasted into an env var with escaped newlines.
    await expect(importPrivateKey(pkcs1.replaceAll("\n", "\\n"))).resolves.toBeDefined();
  });

  it("signs a JWT that the public key verifies, with GitHub's claims", async () => {
    const { pkcs1, publicKey } = await keyPair();
    const now = Date.UTC(2026, 10, 7, 12, 0, 0);
    const app = new GitHubApp({ appId: "12345", installationId: "678", privateKey: pkcs1 }, undefined, () => now);
    const jwt = await app.jwt();
    expect(await verify(jwt, publicKey)).toBe(true);
    const [header, payload] = jwt.split(".").slice(0, 2).map(decodePart);
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(payload).toEqual({ iat: now / 1000 - 60, exp: now / 1000 + 540, iss: "12345" });
  });
});

describe("installation tokens", () => {
  async function setup() {
    const { pkcs1 } = await keyPair();
    let now = Date.UTC(2026, 10, 7, 12, 0, 0);
    const calls: { url: string; body: unknown }[] = [];
    const fakeFetch: Fetch = async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({ token: `ghs_${calls.length}`, expires_at: new Date(now + 60 * 60 * 1000).toISOString() });
    };
    const app = new GitHubApp({ appId: "1", installationId: "678", privateKey: pkcs1 }, fakeFetch, () => now);
    return { app, calls, advance: (ms: number) => (now += ms) };
  }

  it("are scoped to one repository and to contents and pull requests", async () => {
    const { app, calls } = await setup();
    expect(await app.token({ owner: "YuSa0-6", name: "D1Agents" })).toBe("ghs_1");
    expect(calls[0].url).toBe("https://api.github.com/app/installations/678/access_tokens");
    expect(calls[0].body).toEqual({
      repositories: ["D1Agents"],
      permissions: { contents: "write", pull_requests: "write" }
    });
  });

  it("are cached until five minutes before they expire", async () => {
    const { app, calls, advance } = await setup();
    const repo = { owner: "YuSa0-6", name: "D1Agents" };
    await app.token(repo);
    advance(50 * 60 * 1000);
    expect(await app.token(repo)).toBe("ghs_1");
    advance(6 * 60 * 1000);
    expect(await app.token(repo)).toBe("ghs_2");
    expect(calls).toHaveLength(2);
  });
});
