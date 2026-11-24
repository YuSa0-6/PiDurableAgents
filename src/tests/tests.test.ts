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

const PNPM_INSTALL = ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"];

function installArgs(argv: readonly string[]) {
  const [shell, flag, , name, stamp, ...install] = argv;
  return { shell, flag, name, stamp, install };
}

describe("the run_tests tool", () => {
  it("installs from the lockfile, then runs the script with its package manager", async () => {
    const stub = await project({ "package.json": PACKAGE, "pnpm-lock.yaml": "lockfileVersion: 9" });
    await stub.queueCommandResults([
      { exitCode: 0, stdout: "Packages: +12", stderr: "" },
      { exitCode: 0, stdout: "2 passed", stderr: "" },
    ]);
    const result = await stub.runTool("run_tests", { dir: `${DIR}/`, script: "test" });
    expect(result).toEqual({
      isError: false,
      text: [
        "Dependencies: pnpm install --frozen-lockfile --ignore-scripts passed with exit code 0 in 1.5s.",
        "pnpm run test passed with exit code 0 in 1.5s.",
        "--- stdout ---",
        "2 passed",
        "--- stderr ---",
        "(empty)",
      ].join("\n"),
    });
    const [install, test] = await stub.commands();
    expect(install?.cwd).toBe(DIR);
    const args = installArgs(install?.argv ?? []);
    expect(args).toMatchObject({ shell: "sh", flag: "-c", name: "sh", install: PNPM_INSTALL });
    expect(args.stamp).toMatch(/^[0-9a-f]{64}$/);
    expect(test).toEqual({ argv: ["pnpm", "run", "test"], cwd: DIR });
  });

  it("says when dependencies were already installed", async () => {
    const stub = await project({ "package.json": PACKAGE, "bun.lock": "{}" });
    await stub.queueCommandResults([
      { exitCode: 0, stdout: "Dependencies are up to date.\n", stderr: "" },
    ]);
    const result = await stub.runTool("run_tests", { dir: DIR, script: "test" });
    expect(result.text.split("\n")[0]).toBe("Dependencies: up to date.");
  });

  it("changes the stamp when the lockfile or package.json changes", async () => {
    const stamps: string[] = [];
    for (const lock of ["a", "b"]) {
      const stub = await project({ "package.json": PACKAGE, "pnpm-lock.yaml": lock });
      await stub.runTool("run_tests", { dir: DIR, script: "test" });
      stamps.push(installArgs((await stub.commands())[0]?.argv ?? []).stamp ?? "");
    }
    expect(stamps[0]).not.toBe(stamps[1]);
  });

  it("installs at the nearest parent with a lockfile and tests in the package", async () => {
    const stub = env.PI_HARNESS_TEST.getByName(crypto.randomUUID());
    await stub.writeWorkspaceFile("/workspace/mono/package-lock.json", "{}");
    await stub.writeWorkspaceFile("/workspace/mono/package.json", "{}");
    await stub.writeWorkspaceFile("/workspace/mono/packages/app/package.json", PACKAGE);
    await stub.runTool("run_tests", { dir: "/workspace/mono/packages/app", script: "test" });
    const [install, test] = await stub.commands();
    expect(install?.cwd).toBe("/workspace/mono");
    expect(installArgs(install?.argv ?? []).install).toEqual([
      "npm",
      "ci",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]);
    expect(test).toEqual({ argv: ["npm", "run", "test"], cwd: "/workspace/mono/packages/app" });
  });

  it("runs the script without installing when there is no lockfile", async () => {
    const stub = await project({ "package.json": PACKAGE });
    const result = await stub.runTool("run_tests", { dir: DIR, script: "test" });
    expect(result.text.split("\n")[0]).toBe("Dependencies: no lockfile, nothing installed.");
    expect(await stub.commands()).toEqual([{ argv: ["npm", "run", "test"], cwd: DIR }]);
  });

  it("stops before the script when the install fails", async () => {
    const stub = await project({ "package.json": PACKAGE, "yarn.lock": "" });
    await stub.queueCommandResults([
      { exitCode: 1, stdout: "", stderr: "registry.example.com is blocked" },
    ]);
    const result = await stub.runTool("run_tests", { dir: DIR, script: "test" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Installing dependencies failed, so test did not run.");
    expect(result.text).toContain("registry.example.com is blocked");
    expect(await stub.commands()).toHaveLength(1);
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
    [{ dir: DIR, script: "deploy" }, "is not a test script", {}],
    [{ dir: DIR, script: "lint" }, 'package.json has no "lint" script', {}],
    [{ dir: "/etc", script: "test" }, "is not inside /workspace", {}],
    [{ dir: "/workspace/missing", script: "test" }, "", {}],
    [{ dir: DIR, script: "test" }, "Yarn 2 or later", { "yarn.lock": "", ".yarnrc.yml": "" }],
  ])("refuses %j without running anything", async (args, message, extra) => {
    const stub = await project({ "package.json": PACKAGE, ...extra });
    const result = await stub.runTool("run_tests", args);
    expect(result.isError).toBe(true);
    expect(result.text).toContain(message);
    expect(await stub.commands()).toEqual([]);
  });
});
