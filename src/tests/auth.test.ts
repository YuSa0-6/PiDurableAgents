import { describe, expect, it } from "vite-plus/test";
import { app } from "../router";

const env = { API_TOKEN: "s3cret" } as unknown as Env;

function call(path: string, headers: Record<string, string> = {}) {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" }, env);
}

describe("API auth", () => {
  it("rejects a request without the token", async () => {
    expect((await call("/api/decide")).status).toBe(401);
    expect((await call("/api/events", { authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("lets a request with the token through", async () => {
    // Past auth, the body fails validation: 400, not 401.
    expect((await call("/api/decide", { authorization: "Bearer s3cret" })).status).toBe(400);
  });

  it("keeps the health check open", async () => {
    const response = await app.request("/api/health", {}, env);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { auth: string }).auth).toBe("bearer");
  });
});
