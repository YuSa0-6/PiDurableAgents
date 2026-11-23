import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type RunOptions = { readonly quiet?: boolean };

export function run(cmd: readonly string[], options: RunOptions = {}) {
  const [command = "", ...args] = cmd;
  const proc = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const stdout = proc.stdout ?? "";
  const output = `${stdout}${proc.stderr ?? ""}`;
  const ok = proc.status === 0;
  if (!ok && !options.quiet) process.stderr.write(tail(output, 80));
  return { ok, stdout, output };
}

export function stream(cmd: readonly string[], input?: string) {
  const [command = "", ...args] = cmd;
  const proc = spawnSync(command, args, {
    input,
    maxBuffer: 256 * 1024 * 1024,
    stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
  });
  return proc.status === 0;
}

export function git(...args: string[]) {
  const result = run(["git", ...args], { quiet: true });
  return result.ok ? result.stdout.trim() : "";
}

export function gitOrExit(...args: string[]) {
  const result = run(["git", ...args]);
  if (!result.ok) process.exit(1);
  return result.stdout;
}

export function bin(name: string) {
  const local = path.join(process.cwd(), "node_modules", ".bin", name);
  return existsSync(local) ? local : name;
}

export function has(command: string) {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .some((dir) => dir && existsSync(path.join(dir, command)));
}

function tail(text: string, lines: number) {
  return `${text.trimEnd().split("\n").slice(-lines).join("\n")}\n`;
}

export function finish(ok: boolean): never {
  process.exit(ok ? 0 : 1);
}
