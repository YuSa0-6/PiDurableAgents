import { readFileSync, writeFileSync } from "node:fs";
import { finish, run, stream } from "../lib";

type Mutant = {
  readonly name: string;
  readonly file: string;
  readonly from: string;
  readonly to: string;
};

const CHECK = ["bunx", "vp", "test", "run", "--config", "src/tests/vitest.verify.config.ts"];

const MUTANTS: readonly Mutant[] = [
  {
    name: "counts the whole session, not only this run",
    file: "src/infra/pi/extensions/budget.ts",
    from: '{ minEntryId: run.first, order: "ascending" }',
    to: '{ order: "ascending" }',
  },
  {
    name: "the stop does not end the run",
    file: "src/infra/pi/extensions/budget.ts",
    from: "result: { terminate: true }",
    to: "result: { terminate: false }",
  },
  {
    name: "tool rounds counted one short",
    file: "src/infra/pi/extensions/budget.ts",
    from: "turns: run?.turns ?? 0,",
    to: "turns: (run?.turns ?? 1) - 1,",
  },
  {
    name: "only the latest model call's tokens counted",
    file: "src/infra/pi/extensions/budget.ts",
    from: "usage.tokens += message.usage.totalTokens;",
    to: "usage.tokens = message.usage.totalTokens;",
  },
  {
    name: "a limit is reached only when passed",
    file: "src/domain/budget.ts",
    from: "usage[key] >= limits[key]",
    to: "usage[key] > limits[key]",
  },
];

function withMutant(mutant: Mutant): "caught" | "missed" | "stale" {
  const original = readFileSync(mutant.file, "utf8");
  if (original.split(mutant.from).length !== 2) return "stale";
  writeFileSync(mutant.file, original.replace(mutant.from, mutant.to));
  try {
    return run(CHECK, { quiet: true }).ok ? "missed" : "caught";
  } finally {
    writeFileSync(mutant.file, original);
  }
}

if (process.argv.includes("--mutants")) {
  const results = MUTANTS.map((mutant) => {
    const result = withMutant(mutant);
    console.log(`${result}\t${mutant.name}`);
    return result;
  });
  finish(results.every((result) => result === "caught"));
}
finish(stream(CHECK));
