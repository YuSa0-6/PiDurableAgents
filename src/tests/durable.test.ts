import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vite-plus/test";

/**
 * Pi Durable keeps a session in its Durable Object's SQLite, so the
 * session and its workspace outlive the object's eviction from memory.
 * The read also checks that the workspace tools hand the model the file a
 * read returns (pi gives the model only a result's `output`).
 */
describe("a durable session", () => {
  it("keeps its workspace across an eviction", async () => {
    const name = crypto.randomUUID();
    const before = env.PI_HARNESS_TEST.getByName(name);
    await before.writeWorkspaceFile("/workspace/kept.txt", "still here");
    await evictDurableObject(before);
    const after = env.PI_HARNESS_TEST.getByName(name);
    const result = await after.prompt("read /workspace/kept.txt");
    expect(result.status).toBe("done");
    expect(result.text).toMatch(/^tool said: .*still here/s);
  });

  it("answers again after an eviction", async () => {
    const name = crypto.randomUUID();
    const before = env.PI_HARNESS_TEST.getByName(name);
    expect((await before.prompt("first")).text).toBe("echo: first");
    await evictDurableObject(before);
    const after = env.PI_HARNESS_TEST.getByName(name);
    expect((await after.prompt("second")).text).toBe("echo: second");
  });
});
