import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { codePaths, git, root, run } from "./lib";

const evidenceDir = path.join(root, ".verify");
const head = git("rev-parse", "HEAD");

function covers(sha: string) {
  if (sha === head) return true;
  if (!run(["git", "merge-base", "--is-ancestor", sha, "HEAD"], { quiet: true }).ok) return false;
  const diff = run(["git", "diff", "--name-only", sha, "HEAD", "--", ...codePaths], {
    quiet: true,
  });
  return diff.ok && diff.output.trim() === "";
}

const verified =
  existsSync(evidenceDir) &&
  readdirSync(evidenceDir)
    .filter((name) => /^[0-9a-f]{40}\.md$/.test(name))
    .filter((name) => statSync(path.join(evidenceDir, name)).size > 0)
    .some((name) => covers(name.slice(0, 40)));

if (verified) process.exit(0);

const reason = [
  "PR を作る前に実アプリで確かめてください(pstack の verify)。",
  "1. `.claude/skills/verify-pi-durable/SKILL.md` の手順で `cf dev` を起動し、変えた機能を HTTP / MCP で呼びます。",
  "2. `scripts/record.sh` で `.verify/" + head + ".md` に記録します。",
  "3. もう一度 PR を作ります。",
].join("\n");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }),
);
