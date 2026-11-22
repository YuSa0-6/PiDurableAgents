import { Refusal } from "./errors";

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

const ALLOWED_SCRIPT = /^(test|test:[a-z0-9:_-]+|check|lint|typecheck)$/;

export const ALLOWED_SCRIPTS_TEXT = '"test", "test:<name>", "check", "lint" or "typecheck"';

export function packageManagerFor(files: readonly string[]): PackageManager {
  return LOCKFILES.find(([lockfile]) => files.includes(lockfile))?.[1] ?? "npm";
}

export function requireTestScript(script: string, declared: readonly string[]): string {
  if (!ALLOWED_SCRIPT.test(script)) {
    throw new Refusal(`${script} is not a test script. Use ${ALLOWED_SCRIPTS_TEXT}.`);
  }
  if (!declared.includes(script)) {
    const known = declared.filter((name) => ALLOWED_SCRIPT.test(name));
    throw new Refusal(
      `package.json has no "${script}" script. Test scripts it has: ${known.join(", ") || "none"}.`,
    );
  }
  return script;
}

export function scriptsOf(packageJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJson);
  } catch {
    throw new Refusal("package.json is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || !("scripts" in parsed)) return [];
  const scripts = parsed.scripts;
  if (typeof scripts !== "object" || scripts === null) return [];
  return Object.keys(scripts);
}

export function testCommand(manager: PackageManager, script: string): string[] {
  return [manager, "run", script];
}

export type TestRun = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly elapsedMs: number;
};

export function tail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `[${text.length - maxChars} earlier characters cut]\n${text.slice(-maxChars)}`;
}

export function describeTestRun(
  command: readonly string[],
  run: TestRun,
  maxChars: number,
): string {
  const verdict = run.exitCode === 0 ? "passed" : "failed";
  const seconds = (run.elapsedMs / 1000).toFixed(1);
  return [
    `${command.join(" ")} ${verdict} with exit code ${run.exitCode} in ${seconds}s.`,
    `--- stdout ---\n${tail(run.stdout, maxChars) || "(empty)"}`,
    `--- stderr ---\n${tail(run.stderr, maxChars) || "(empty)"}`,
  ].join("\n");
}
