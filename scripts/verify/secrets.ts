import { finish, git, gitOrExit, has, stream } from "../lib";

const excluded = [":(exclude)bun.lock", ":(exclude)pnpm-lock.yaml"];
const scanStdin = ["betterleaks", "stdin", "--redact", "--no-banner"];

function scan(patch: string) {
  return stream(scanStdin, patch);
}

function pushedPatch() {
  const base =
    git("rev-parse", "--verify", "--quiet", "@{upstream}") ||
    git("rev-parse", "--verify", "--quiet", "origin/main");
  const range = base ? `${base}..HEAD` : "HEAD";
  return gitOrExit("log", "--no-color", "-p", range, "--", ".", ...excluded);
}

const modes: Record<string, () => boolean> = {
  staged: () =>
    scan(gitOrExit("diff", "--cached", "--no-color", "--unified=0", "--", ".", ...excluded)),
  push: () => scan(pushedPatch()),
  all: () =>
    stream(["betterleaks", "git", ".", "--config", ".betterleaks.toml", "--redact", "--no-banner"]),
};

const mode = process.argv[2] ?? "staged";
const check = modes[mode];
if (!check) {
  process.stderr.write("usage: bun scripts/verify/secrets.ts staged|push|all\n");
  process.exit(2);
}

if (!has("betterleaks")) {
  process.stderr.write(
    "betterleaks が見つからないので秘密情報の検査を飛ばします(CI では必ず実行されます)。\n" +
      "入れ方: brew install betterleaks / go install github.com/betterleaks/betterleaks@v1.10.1\n",
  );
  finish(true);
}

finish(check());
