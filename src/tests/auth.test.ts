import { describe, expect, it } from "vite-plus/test";
import { app } from "../router";

const env = { API_TOKEN: "s3cret" } as unknown as Env;

function call(path: string, headers: Record<string, string> = {}) {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" }, env);
}

describe("API auth", () => {
  it("rejects a request without the token", async () => {
    expect((await call("/api/events")).status).toBe(401);
    expect((await call("/api/events", { authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("lets a request with the token through", async () => {
    expect((await call("/api/events", { authorization: "Bearer s3cret" })).status).toBe(400);
  });

  it("hands out repository read tokens only once API_TOKEN is set", async () => {
    const open = await app.request("/api/sessions/demo/repos", {}, {} as unknown as Env);
    expect(open.status).toBe(403);
    expect((await app.request("/api/sessions/demo/repos", {}, env)).status).toBe(401);
  });

  it("keeps the health check open", async () => {
    const response = await app.request("/api/health", {}, env);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { auth: string }).auth).toBe("bearer");
  });
});
