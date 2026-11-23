import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { git, root } from "../../scripts/lib";

export { bin, git, root, run } from "../../scripts/lib";

export const codePaths = [
  "src/",
  "lint/",
  "scripts/",
  "package.json",
  "bun.lock",
  "vite.config.ts",
  "cloudflare.config.ts",
  "tsconfig.json",
  "tsconfig.tools.json",
];

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
