import { bin, finish, git, stream } from "../lib";

const base = git("rev-parse", "--verify", "--quiet", "origin/main") || "HEAD~1";

const steps: string[][] = [
  ["bun", "scripts/verify/secrets.ts", "push"],
  [bin("fallow"), "audit", "--base", base, "--quiet"],
  [bin("vp"), "test", "run", "--config", "src/tests/vitest.config.ts"],
];

finish(steps.every((step) => stream(step)));
