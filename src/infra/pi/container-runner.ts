import { remoteExec, type ExecTarget } from "@cloudflare/computer/remote-exec";
import type { Workspace } from "@cloudflare/computer";
import type { CommandRunner } from "./extensions/tests";

const PUSH_GLOBS = ["**", "!**/node_modules/**", "!**/.git/**"];

async function textOf(stream: ReadableStream<Uint8Array> | undefined): Promise<string> {
  return stream ? new Response(stream).text() : "";
}

export function containerRunner(
  target: () => ExecTarget,
  workspace: Workspace,
  env: Record<string, string> = { CI: "1" },
): CommandRunner {
  return async (argv, cwd) => {
    const process = await remoteExec(
      {
        target: target(),
        fs: workspace.fs,
        workspaceRoot: "/workspace",
        containerRoot: "/workspace",
      },
      argv,
      { cwd, env, push: PUSH_GLOBS, pull: [] },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      textOf(process.stdout),
      textOf(process.stderr),
      process.exitCode,
    ]);
    return { exitCode, stdout, stderr };
  };
}
