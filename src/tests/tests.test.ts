import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";

const DIR = "/workspace/app";

async function project(files: Record<string, string>) {
  const stub = env.PI_HARNESS_TEST.getByName(crypto.randomUUID());
  for (const [name, text] of Object.entries(files)) {
    await stub.writeWorkspaceFile(`${DIR}/${name}`, text);
  }
  return stub;
}

const PACKAGE = JSON.stringify({ scripts: { test: "vitest run", deploy: "cf deploy" } });

describe("the run_tests tool", () => {
  it("runs the script with the lockfile's package manager in the project directory", async () => {
    const stub = await project({ "package.json": PACKAGE, "pnpm-lock.yaml": "" });
    await stub.setCommandResult({ exitCode: 0, stdout: "2 passed", stderr: "" });
    const result = await stub.runTool("run_tests", { dir: `${DIR}/`, script: "test" });
    expect(result).toEqual({
      isError: false,
      text: "pnpm run test passed with exit code 0 in 1.5s.\n--- stdout ---\n2 passed\n--- stderr ---\n(empty)",
    });
    expect(await stub.commands()).toEqual([{ argv: ["pnpm", "run", "test"], cwd: DIR }]);
  });

  it("reports a failing run as an error with its output", async () => {
    const stub = await project({ "package.json": PACKAGE });
    await stub.setCommandResult({ exitCode: 1, stdout: "", stderr: "expected 2 to be 3" });
    const result = await stub.runTool("run_tests", { dir: DIR, script: "test" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("npm run test failed with exit code 1");
    expect(result.text).toContain("expected 2 to be 3");
  });

  it.each([
    [{ dir: DIR, script: "deploy" }, "is not a test script"],
    [{ dir: DIR, script: "lint" }, 'package.json has no "lint" script'],
    [{ dir: "/etc", script: "test" }, "is not inside /workspace"],
    [{ dir: "/workspace/missing", script: "test" }, ""],
  ])("refuses %j without running anything", async (args, message) => {
    const stub = await project({ "package.json": PACKAGE });
    const result = await stub.runTool("run_tests", args);
    expect(result.isError).toBe(true);
    expect(result.text).toContain(message);
    expect(await stub.commands()).toEqual([]);
  });
});
