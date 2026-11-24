import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { RegistryEgress } from "../application/registry-egress";

function egress() {
  return new RegistryEgress(createExecutionContext(), env as unknown as Env);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RegistryEgress", () => {
  it("forwards a package read to the registry over HTTPS without credentials", async () => {
    const seen: Request[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      seen.push(new Request(input, init));
      return new Response("{}", { status: 200 });
    });
    const response = await egress().fetch(
      new Request("http://registry.npmjs.org/react?write=true", {
        headers: {
          accept: "application/json",
          authorization: "Bearer from-the-container",
          cookie: "a=b",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(seen.map((request) => request.url)).toEqual([
      "https://registry.npmjs.org/react?write=true",
    ]);
    expect(seen[0]?.headers.get("accept")).toBe("application/json");
    expect(seen[0]?.headers.get("authorization")).toBeNull();
    expect(seen[0]?.headers.get("cookie")).toBeNull();
  });

  it.each([
    ["GET", "https://evil.example/x", "evil.example is blocked"],
    ["PUT", "https://registry.npmjs.org/pkg", "PUT to registry.npmjs.org is blocked"],
  ])("answers 403 to %s %s and sends nothing", async (method, url, message) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await egress().fetch(new Request(url, { method }));
    expect(response.status).toBe(403);
    expect(await response.text()).toContain(message);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
