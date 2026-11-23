import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";

async function readFileWithBudget(budget: Record<string, number>) {
  const agent = env.PI_HARNESS_TEST.getByName(crypto.randomUUID());
  await agent.setBudget(budget);
  await agent.writeWorkspaceFile("/workspace/note.txt", "hello");
  const result = await agent.prompt("read /workspace/note.txt");
  return { result, stops: await agent.budgetStops() };
}

describe("run budget", () => {
  it("lets a run inside the budget answer after its tools", async () => {
    const { result, stops } = await readFileWithBudget({});
    expect(result.status).toBe("done");
    expect(result.text).toMatch(/^tool said: .*hello/s);
    expect(stops).toEqual([]);
  });

  it("ends the run after the tool round that reaches the turn limit and logs why", async () => {
    const { result, stops } = await readFileWithBudget({ turns: 1 });
    expect(result.status).toBe("done");
    expect(result.text ?? "").not.toMatch(/tool said/);
    expect(stops).toEqual(["Run budget reached: tool rounds 1 of 1."]);
  });

  it("counts the tokens the run spent", async () => {
    const { stops } = await readFileWithBudget({ tokens: 1 });
    expect(stops).toEqual([expect.stringMatching(/^Run budget reached: tokens \d+ of 1\.$/)]);
  });

  it("measures the time since the run started", async () => {
    const { stops } = await readFileWithBudget({ elapsedMs: 1 });
    expect(stops).toEqual([
      expect.stringMatching(/^Run budget reached: elapsed milliseconds \d+ of 1\.$/),
    ]);
  });
});
