import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";

function object() {
  return env.PI_HARNESS_TEST.getByName(crypto.randomUUID());
}

/**
 * Pi Durable's code mode: the model sends one script, which calls the
 * session's tools as `tools.<name>()` inside QuickJS. (The faux model answers
 * a tool result with `tool said: <result>`.)
 */
describe("code mode", () => {
  it("runs a script that calls several tools and returns their joined result", async () => {
    const stub = object();
    await stub.writeWorkspaceFile("/workspace/a.txt", "alpha");
    await stub.writeWorkspaceFile("/workspace/b.txt", "beta");
    const result = await stub.prompt(
      'codemode const [a, b] = await Promise.all(["/workspace/a.txt", "/workspace/b.txt"].map((path) => tools.read({ path }))); console.log(JSON.stringify([a, b]));'
    );
    expect(result.status).toBe("done");
    expect(result.text).toMatch(/^tool said: /);
    expect(result.text).toContain("alpha");
    expect(result.text).toContain("beta");
  });

  it("keeps the GitHub rules for calls made from a script", async () => {
    const stub = object();
    await stub.gitRepo("/workspace/d1agents");
    const result = await stub.prompt(
      'codemode const r = await tools.git_push({ repo: "YuSa0-6/D1Agents", dir: "/workspace/d1agents" }); console.log(JSON.stringify(r));'
    );
    expect(result.status).toBe("done");
    expect(result.text).toContain("Branch main is not allowed");
    // Refused before any token was minted.
    expect((await stub.githubCalls()).tokens).toEqual([]);
  });

  it("stops a script that computes past its interrupt budget", async () => {
    const stub = object();
    const result = await stub.prompt("codemode while (true) {}");
    expect(result.status).toBe("done");
    expect(result.text).toMatch(/^tool failed: /);
  });
});
