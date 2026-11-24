import { describe, expect, it } from "vite-plus/test";
import { Refusal } from "./errors";
import {
  describeTestRun,
  ensureDepsCommand,
  lockfileIn,
  parentDirs,
  requireSupportedYarn,
  requireTestScript,
  scriptsOf,
  tail,
  testCommand,
} from "./test-run";

describe("lockfileIn", () => {
  it.each([
    [["bun.lock", "package.json"], "bun.lock", "bun"],
    [["bun.lockb"], "bun.lockb", "bun"],
    [["pnpm-lock.yaml"], "pnpm-lock.yaml", "pnpm"],
    [["yarn.lock"], "yarn.lock", "yarn"],
    [["package-lock.json"], "package-lock.json", "npm"],
  ] as const)("finds the lockfile and its manager in %j", (files, name, manager) => {
    expect(lockfileIn(files)).toEqual({ name, manager });
  });

  it("finds nothing without a lockfile", () => {
    expect(lockfileIn(["package.json"])).toBeUndefined();
  });
});

describe("requireSupportedYarn", () => {
  it("refuses Yarn 2 or later and lets the rest through", () => {
    expect(() => requireSupportedYarn(["yarn.lock", ".yarnrc.yml"])).toThrow(Refusal);
    expect(() => requireSupportedYarn(["yarn.lock"])).not.toThrow();
  });
});

describe("parentDirs", () => {
  it("lists the directory and its parents down to the top folder under /workspace", () => {
    expect(parentDirs("/workspace/repo/packages/app")).toEqual([
      "/workspace/repo/packages/app",
      "/workspace/repo/packages",
      "/workspace/repo",
    ]);
    expect(parentDirs("/workspace/repo")).toEqual(["/workspace/repo"]);
  });
});

describe("ensureDepsCommand", () => {
  it("runs the frozen install without scripts unless the marker matches the stamp", () => {
    const [shell, flag, script, name, stamp, ...install] = ensureDepsCommand("pnpm", "abc");
    expect([shell, flag, name, stamp]).toEqual(["sh", "-c", "sh", "abc"]);
    expect(script).toContain(
      'mkdir -p node_modules && echo "$stamp" > node_modules/.d1agents-lock',
    );
    expect(install).toEqual(["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"]);
    expect(ensureDepsCommand("npm", "abc").slice(5)).toEqual([
      "npm",
      "ci",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]);
  });
});

describe("requireTestScript", () => {
  const declared = ["build", "test", "test:workers", "check", "deploy"];

  it.each(["test", "test:workers", "check"])("accepts %s when package.json has it", (script) => {
    expect(requireTestScript(script, declared)).toBe(script);
  });

  it.each(["build", "deploy", "test; rm -rf /", "TEST", "test:", ""])("refuses %j", (script) => {
    expect(() => requireTestScript(script, declared)).toThrow(Refusal);
  });

  it("names the test scripts package.json has when the asked one is missing", () => {
    expect(() => requireTestScript("lint", declared)).toThrow(
      'package.json has no "lint" script. Test scripts it has: test, test:workers, check.',
    );
  });
});

describe("scriptsOf", () => {
  it("lists the script names", () => {
    expect(scriptsOf('{"scripts":{"test":"vitest","lint":"oxlint"}}')).toEqual(["test", "lint"]);
  });

  it("returns none without scripts", () => {
    expect(scriptsOf('{"name":"x"}')).toEqual([]);
    expect(scriptsOf('{"scripts":null}')).toEqual([]);
  });

  it("refuses broken JSON", () => {
    expect(() => scriptsOf("{")).toThrow(Refusal);
  });
});

describe("testCommand", () => {
  it("runs the script through the package manager without a shell", () => {
    expect(testCommand("pnpm", "test:workers")).toEqual(["pnpm", "run", "test:workers"]);
  });
});

describe("describeTestRun", () => {
  it("keeps the end of long output", () => {
    expect(tail("abcdef", 3)).toBe("[3 earlier characters cut]\ndef");
    expect(tail("abc", 3)).toBe("abc");
  });

  it("states the verdict, exit code and time", () => {
    const text = describeTestRun(
      ["npm", "run", "test"],
      { exitCode: 1, stdout: "1 failed", stderr: "", elapsedMs: 2500 },
      100,
    );
    expect(text).toBe(
      "npm run test failed with exit code 1 in 2.5s.\n--- stdout ---\n1 failed\n--- stderr ---\n(empty)",
    );
  });
});
