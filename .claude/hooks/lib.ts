import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

export const codePaths = [
  "src/",
  "package.json",
  "bun.lock",
  "vite.config.ts",
  "cloudflare.config.ts",
  "tsconfig.json",
];

export function run(cmd: string[], quiet = false) {
  const [command = "", ...args] = cmd;
  const proc = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
  if (!quiet && proc.status !== 0) process.stderr.write(tail(output, 80));
  return { ok: proc.status === 0, output };
}

export function git(...args: string[]) {
  const result = run(["git", ...args], true);
  return result.ok ? result.output.trim() : "";
}

export function bin(name: string) {
  const local = path.join(root, "node_modules", ".bin", name);
  return existsSync(local) ? local : name;
}

export function tail(text: string, lines: number) {
  return `${text.trimEnd().split("\n").slice(-lines).join("\n")}\n`;
}

export function isCode(file: string) {
  return codePaths.some((p) => (p.endsWith("/") ? file.startsWith(p) : file === p));
}

export function changedFiles() {
  const base = git("merge-base", "origin/main", "HEAD");
  const committed = base ? git("diff", "--name-only", base, "HEAD") : "";
  const working = git("diff", "--name-only", "HEAD");
  const untracked = git("ls-files", "--others", "--exclude-standard");
  return [...new Set(`${committed}\n${working}\n${untracked}`.split("\n").filter(Boolean))];
}

export function workingTreeFingerprint() {
  const hash = createHash("sha256");
  hash.update(git("rev-parse", "HEAD"));
  hash.update(git("diff", "HEAD"));
  for (const file of git("ls-files", "--others", "--exclude-standard")
    .split("\n")
    .filter(Boolean)) {
    hash.update(file);
    const full = path.join(root, file);
    if (existsSync(full)) hash.update(readFileSync(full));
  }
  return hash.digest("hex");
}

export function readInput<T>() {
  return JSON.parse(readFileSync(0, "utf8") || "{}") as T;
}
