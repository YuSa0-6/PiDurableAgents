import { writeFileSync } from "node:fs";
import path from "node:path";
import { git } from "../../../../scripts/lib";
import { files, readText, root } from "./run-dir";

const summary = process.argv[2];
if (!summary) {
  process.stderr.write('usage: bun record.ts "<what was verified>"\n');
  process.exit(2);
}
const sha = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain").split("\n").filter(Boolean).length;
const out = path.join(root, ".verify", `${sha}.md`);
writeFileSync(
  out,
  [
    `# verify ${sha}`,
    "",
    `- date: ${new Date().toISOString()}`,
    `- summary: ${summary}`,
    `- dirty files: ${dirty}`,
    "",
    "## calls",
    "",
    "```",
    readText(files.calls),
    "```",
    "",
  ].join("\n"),
);
console.log(`wrote ${out}`);
