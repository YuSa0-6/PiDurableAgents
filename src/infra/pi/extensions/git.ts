import type { Workspace } from "@cloudflare/computer";
import {
  defineTool,
  type Extension,
  type ToolExecutionResult,
  type ToolPark,
} from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";
import { BRANCH_PREFIX, requireAgentBranch } from "../../../domain/agent-branch";
import { Refusal } from "../../../domain/errors";
import { workspacePath } from "../../../domain/workspace-path";

const COMMIT_AUTHOR = { name: "d1agents-bot", email: "d1agents-bot@noreply.d1agents.invalid" };

export async function currentBranch(workspace: Workspace, dir: string): Promise<string> {
  const branch = await workspace.git.currentBranch({ dir });
  if (!branch) throw new Refusal(`${dir} is not on a branch (detached HEAD).`);
  return branch;
}

export function ok(text: string): ToolExecutionResult {
  return { output: [{ type: "text", text }] };
}

export function fail(text: string): ToolExecutionResult {
  return { output: [{ type: "text", text }], isError: true };
}

export async function guarded<T extends ToolExecutionResult | ToolPark>(
  run: () => Promise<T>,
): Promise<T | ToolExecutionResult> {
  try {
    return await run();
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export async function redacting(
  secrets: readonly string[],
  work: () => Promise<ToolExecutionResult>,
): Promise<ToolExecutionResult> {
  const scrub = (text: string) =>
    secrets.filter(Boolean).reduce((out, secret) => out.replaceAll(secret, "[redacted]"), text);
  let result: ToolExecutionResult;
  try {
    result = await work();
  } catch (error) {
    result = fail(error instanceof Error ? error.message : String(error));
  }
  return {
    ...result,
    output: (result.output ?? []).map((part) =>
      part.type === "text" ? { ...part, text: scrub(part.text) } : part,
    ),
  };
}

const DirParam = str({
  description: "The repository's working tree, an absolute path under /workspace.",
});

export function createGitExtension(workspace: Workspace): Extension {
  const git = workspace.git;
  return {
    name: "git",
    tools: [
      defineTool({
        name: "git_branch",
        description: `Create a branch under ${BRANCH_PREFIX} from HEAD and switch to it. Do this before committing.`,
        parameters: obj({
          dir: DirParam,
          name: str({
            description: `New branch name. Must start with ${BRANCH_PREFIX}, e.g. agent/fix-typo.`,
          }),
        }),
        replay: "unsafe",
        execute: (args) =>
          guarded(async () => {
            const where = workspacePath(args.dir);
            requireAgentBranch(args.name);
            await git.branch({ dir: where, name: args.name, checkout: true });
            return ok(`Created ${args.name} in ${where} and switched to it.`);
          }),
      }),
      defineTool({
        name: "git_commit",
        description:
          "Stage every change in the working tree (new, modified and deleted files) and commit it.",
        parameters: obj({
          dir: DirParam,
          message: str({
            description: "Commit message: a short summary line, a blank line, then details.",
          }),
        }),
        replay: "unsafe",
        execute: (args) =>
          guarded(async () => {
            const where = workspacePath(args.dir);
            await git.add({ dir: where, paths: [], all: true });
            const staged = (await git.status({ dir: where })).filter(
              (entry) => entry.index !== " ",
            );
            if (staged.length === 0)
              return fail("Nothing to commit: the working tree matches HEAD.");
            const { oid } = await git.commit({
              dir: where,
              message: args.message,
              author: COMMIT_AUTHOR,
            });
            return ok(
              `Committed ${staged.length} file(s) on ${await currentBranch(workspace, where)} as ${oid.slice(0, 7)}.`,
            );
          }),
      }),
    ],
  };
}
