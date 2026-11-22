import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { codePaths, git, root, run } from "./lib";

const evidenceDir = path.join(root, ".verify");
const head = git("rev-parse", "HEAD");

function covers(sha: string) {
  if (sha === head) return true;
  if (!run(["git", "merge-base", "--is-ancestor", sha, "HEAD"], true).ok) return false;
  const diff = run(["git", "diff", "--name-only", sha, "HEAD", "--", ...codePaths], true);
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
  "PR を作る前に pstack の検証(実アプリを動かして確かめる)を済ませてください。",
  "1. このリポジトリの verify スキルがあれば使い、なければ `bun run start`(cf dev)で起動して、変えた機能を HTTP / MCP で実際に呼んで確かめます。",
  "2. 実行したコマンドと結果(レスポンスやログ)を `.verify/" + head + ".md` に書きます。",
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
