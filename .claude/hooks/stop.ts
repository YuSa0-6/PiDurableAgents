import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bin, changedFiles, isCode, readInput, root, run, workingTreeFingerprint } from "./lib";

const input = readInput<{ stop_hook_active?: boolean }>();
if (input.stop_hook_active) process.exit(0);

if (!changedFiles().some(isCode)) process.exit(0);

const cacheFile = path.join(root, ".claude", ".verify-cache");
const fingerprint = workingTreeFingerprint();
if (existsSync(cacheFile) && readFileSync(cacheFile, "utf8").trim() === fingerprint)
  process.exit(0);

const steps: [string, string[]][] = [
  ["vp check", [bin("vp"), "check"]],
  ["tests", [bin("vp"), "test", "run", "--config", "src/tests/vitest.config.ts"]],
];

for (const [name, cmd] of steps) {
  if (!run(cmd).ok) {
    process.stderr.write(`\n作業を終える前に ${name} が失敗しました。直してから終えてください。\n`);
    process.exit(2);
  }
}

writeFileSync(cacheFile, `${fingerprint}\n`);
