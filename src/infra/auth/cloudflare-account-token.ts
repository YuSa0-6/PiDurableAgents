import type { Authenticator } from "../../usecase/ports/authenticator";

export class CloudflareAccountToken implements Authenticator {
  readonly #accountId: string;

  constructor(accountId: string) {
    this.#accountId = accountId;
  }

  async isAllowed(token: string): Promise<boolean> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.#accountId}/tokens/verify`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!response.ok) return false;
    const body: { result?: { status?: string } } = await response.json();
    return body.result?.status === "active";
  }
}
