import { bin, finish, git, stream } from "../lib";

const steps: string[][] = [
  [bin("vp"), "staged"],
  ["bun", "scripts/verify/secrets.ts", "staged"],
];
if (
  git("diff", "--cached", "--name-only")
    .split("\n")
    .some((file) => file.startsWith(".github/"))
) {
  steps.push(["bun", "scripts/verify/workflows.ts"]);
}

finish(steps.every((step) => stream(step)));
