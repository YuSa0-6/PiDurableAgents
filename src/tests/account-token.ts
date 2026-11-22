import { afterEach, beforeEach, vi } from "vite-plus/test";

export const activeToken = "s3cret";
export const disabledToken = "disabled";
export const accountId = "test-account";

export function stubAccountTokenVerify(): void {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const verify = `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`;
      if (request.url !== verify) return realFetch(input, init);
      const given = request.headers.get("authorization");
      if (given === `Bearer ${activeToken}`) {
        return Response.json({ success: true, result: { status: "active" } });
      }
      if (given === `Bearer ${disabledToken}`) {
        return Response.json({ success: true, result: { status: "disabled" } });
      }
      return Response.json({ success: false, result: null }, { status: 401 });
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
}
