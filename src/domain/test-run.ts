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

export type Lockfile = {
  readonly name: string;
  readonly manager: PackageManager;
};

export function lockfileIn(files: readonly string[]): Lockfile | undefined {
  const found = LOCKFILES.find(([lockfile]) => files.includes(lockfile));
  return found && { name: found[0], manager: found[1] };
}

export function requireSupportedYarn(files: readonly string[]): void {
  if (files.includes(".yarnrc.yml")) {
    throw new Refusal(
      "Yarn 2 or later (.yarnrc.yml) is not supported. Use Yarn 1, npm, pnpm or bun.",
    );
  }
}

export function parentDirs(dir: string): string[] {
  const parts = dir.split("/").filter((part) => part.length > 0);
  const dirs: string[] = [];
  for (let size = parts.length; size >= 2; size--) dirs.push(`/${parts.slice(0, size).join("/")}`);
  return dirs;
}

const INSTALL_COMMANDS: Record<PackageManager, readonly string[]> = {
  bun: ["bun", "install", "--frozen-lockfile", "--ignore-scripts"],
  pnpm: ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"],
  yarn: ["yarn", "install", "--frozen-lockfile", "--ignore-scripts", "--non-interactive"],
  npm: ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
};

const INSTALL_MARKER = "node_modules/.d1agents-lock";

const ENSURE_DEPS_SCRIPT = [
  `if [ "$(cat ${INSTALL_MARKER} 2>/dev/null)" = "$1" ]; then echo "Dependencies are up to date."; exit 0; fi`,
  'stamp="$1"; shift',
  `"$@" && mkdir -p node_modules && echo "$stamp" > ${INSTALL_MARKER}`,
].join("\n");

export function ensureDepsCommand(manager: PackageManager, stamp: string): string[] {
  return ["sh", "-c", ENSURE_DEPS_SCRIPT, "sh", stamp, ...INSTALL_COMMANDS[manager]];
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
