import path from "node:path";
import { bin, readInput, root, run } from "./lib";

const input = readInput<{ tool_input?: { file_path?: string } }>();
const file = input.tool_input?.file_path;
const formattable = /\.(ts|tsx|js|mjs|cjs|json|jsonc|md|ya?ml|css|html)$/;

if (!file || !formattable.test(file)) process.exit(0);
const relative = path.relative(root, path.resolve(root, file));
if (relative.startsWith("..") || relative.startsWith("node_modules")) process.exit(0);

const result = run([bin("vp"), "check", "--fix", "--no-error-on-unmatched-pattern", relative]);
if (!result.ok) {
  process.stderr.write(
    `\n${relative} に vp check で直せない問題があります。上の内容を見て直してください。\n`,
  );
  process.exit(2);
}
