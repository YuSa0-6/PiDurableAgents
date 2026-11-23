import { describe, expect, it } from "vite-plus/test";
import { Refusal } from "./errors";
import {
  describeTestRun,
  packageManagerFor,
  requireTestScript,
  scriptsOf,
  tail,
  testCommand,
} from "./test-run";

describe("packageManagerFor", () => {
  it.each([
    [["bun.lock", "package.json"], "bun"],
    [["bun.lockb"], "bun"],
    [["pnpm-lock.yaml"], "pnpm"],
    [["yarn.lock"], "yarn"],
    [["package-lock.json"], "npm"],
    [["package.json"], "npm"],
  ] as const)("picks the manager from %j", (files, manager) => {
    expect(packageManagerFor(files)).toBe(manager);
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
