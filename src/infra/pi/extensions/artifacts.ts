import type { Workspace } from "@cloudflare/computer";
import type { ArtifactClient } from "@cloudflare/computer/artifacts";
import {
  defineTool,
  type Extension,
  type ToolExecutionResult,
  type ToolPark,
} from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord/json";
import { obj, opt, str } from "@earendil-works/pi-schema";
import { BRANCH_PREFIX, requireAgentBranch } from "../../../domain/agent-branch";
import { Refusal } from "../../../domain/errors";
import { nameFromUrl, repoName } from "../../../domain/repo-name";
import { workspacePath } from "../../../domain/workspace-path";
import { currentBranch, fail, guarded, ok, redacting } from "./git";

export type ArtifactsClient = Pick<
  ArtifactClient,
  "create" | "get" | "list" | "import" | "createToken" | "revokeToken"
>;

const OPERATION_TOKEN_TTL = 10 * 60;
const IMPORT_WAIT_MS = 90_000;

export type ArtifactsOptions = {
  readonly pollMs?: number;
};

const ImportParameters = obj({
  url: str({ description: "HTTPS Git URL, e.g. https://github.com/owner/repo." }),
  name: opt(str({ description: "Repository name. Default: from the URL." })),
  branch: opt(str({ description: "Branch to import. Default: the remote's default branch." })),
  dir: opt(str({ description: "Where to clone. Default: /workspace/<name>." })),
});

type ImportWait = { readonly deadline: number };

function gitHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function createArtifactsExtension(
  workspace: Workspace,
  artifacts: ArtifactsClient,
  options: ArtifactsOptions = {},
): Extension {
  const git = workspace.git;
  const pollMs = options.pollMs ?? 2_000;

  const withToken = async (
    name: string,
    scope: "read" | "write",
    work: (token: string, remote: string) => Promise<ReturnType<typeof ok>>,
  ) => {
    const { remote } = await artifacts.get(name);
    const token = await artifacts.createToken(name, scope, OPERATION_TOKEN_TTL);
    try {
      return await redacting([token.plaintext], () => work(token.plaintext, remote));
    } finally {
      await artifacts.revokeToken(name, token.id).catch(() => false);
    }
  };

  const clone = (name: string, dir: string, ref?: string) =>
    withToken(name, "read", async (token, remote) => {
      await git.clone({ url: remote, dir, ...(ref ? { ref } : {}), headers: gitHeaders(token) });
      return ok(`Cloned ${name} into ${dir} on ${await currentBranch(workspace, dir)}.`);
    });

  const importError = async (name: string): Promise<unknown> => {
    try {
      await artifacts.get(name);
      return undefined;
    } catch (error) {
      return error ?? new Error(`${name} is not ready.`);
    }
  };

  const dropInitialToken = (name: string, token: string) =>
    artifacts.revokeToken(name, token).catch(() => false);

  return {
    name: "artifacts",
    sections: [
      {
        key: "artifacts",
        render: () =>
          [
            "Your git repositories live in Cloudflare Artifacts, one set per session.",
            "To work on existing code: repo_import its public Git URL (it is cloned into /workspace).",
            "To start a project: repo_create. Then git_branch to a branch under agent/, edit files, check your work,",
            "git_commit and repo_push. Push only agent/ branches; you cannot push the default branch or force push.",
            "Do not try to push with exec.",
          ].join(" "),
        tag: false,
      },
    ],
    tools: [
      defineTool<typeof ImportParameters, JsonValue, ImportWait>({
        name: "repo_import",
        description:
          "Import a public Git repository (HTTPS URL) into this session's Artifacts and clone it into /workspace.",
        parameters: ImportParameters,
        replay: "unsafe",
        execute: (args, api) =>
          guarded(async (): Promise<ToolExecutionResult | ToolPark<ImportWait>> => {
            if (new URL(args.url).protocol !== "https:")
              throw new Refusal("Only HTTPS Git URLs can be imported.");
            const name = repoName(args.name ?? nameFromUrl(args.url));
            const dir = workspacePath(args.dir ?? `/workspace/${name}`);
            if (api.checkpoint === undefined) {
              const imported = await artifacts.import(name, {
                url: args.url,
                ...(args.branch ? { branch: args.branch } : {}),
              });
              await dropInitialToken(name, imported.token);
            }
            const deadline = api.checkpoint?.deadline ?? api.now() + IMPORT_WAIT_MS;
            const notReady = await importError(name);
            if (notReady !== undefined) {
              if (api.now() > deadline) throw notReady;
              return { sleep: { checkpoint: { deadline }, until: api.now() + pollMs } };
            }
            const cloned = await clone(name, dir, args.branch);
            if (cloned.isError) return cloned;
            return ok(`Imported ${args.url} as ${name}. ${textOf(cloned)}`);
          }),
      }),
      defineTool({
        name: "repo_create",
        description:
          "Create an empty repository in this session's Artifacts and start a local repository for it in /workspace.",
        parameters: obj({
          name: str({ description: "Repository name: letters, digits, '.', '_' or '-'." }),
          description: opt(str({ description: "One line about the project." })),
          dir: opt(str({ description: "Local directory. Default: /workspace/<name>." })),
        }),
        replay: "unsafe",
        execute: (args) =>
          guarded(async () => {
            const name = repoName(args.name);
            const dir = workspacePath(args.dir ?? `/workspace/${name}`);
            const created = await artifacts.create(name, {
              ...(args.description ? { description: args.description } : {}),
              setDefaultBranch: "main",
            });
            await dropInitialToken(name, created.token);
            await workspace.fs.mkdir(dir, { recursive: true });
            await git.init({ dir, defaultBranch: created.defaultBranch || "main" });
            return ok(
              `Created ${name} and a local repository at ${dir} on ${created.defaultBranch || "main"}. ` +
                `Add files, git_branch to ${BRANCH_PREFIX}..., git_commit, then repo_push.`,
            );
          }),
      }),
      defineTool({
        name: "repo_clone",
        description: "Clone one of this session's Artifacts repositories into /workspace.",
        parameters: obj({
          name: str({ description: "Repository name, as repo_list shows it." }),
          dir: opt(str({ description: "Where to clone. Default: /workspace/<name>." })),
          ref: opt(str({ description: "Branch, tag or commit. Default: the default branch." })),
        }),
        replay: "unsafe",
        execute: (args) =>
          guarded(async () => {
            const name = repoName(args.name);
            return clone(name, workspacePath(args.dir ?? `/workspace/${name}`), args.ref);
          }),
      }),
      defineTool({
        name: "repo_push",
        description: `Push the current branch (it must be under ${BRANCH_PREFIX}) to the same branch of the session's Artifacts repository.`,
        parameters: obj({
          name: str({ description: "Repository name, as repo_list shows it." }),
          dir: str({ description: "The local working tree, an absolute path under /workspace." }),
        }),
        replay: "unsafe",
        execute: (args) =>
          guarded(async () => {
            const name = repoName(args.name);
            const dir = workspacePath(args.dir);
            const branch = await currentBranch(workspace, dir);
            requireAgentBranch(branch);
            return withToken(name, "write", async (token, remote) => {
              const result = await git.push({
                dir,
                url: remote,
                ref: branch,
                remoteRef: branch,
                headers: gitHeaders(token),
              });
              if (!result.ok)
                return fail(`Push of ${branch} failed: ${result.error ?? "unknown error"}`);
              return ok(`Pushed ${branch} to ${name}.`);
            });
          }),
      }),
      defineTool({
        name: "repo_list",
        description: "List this session's Artifacts repositories.",
        parameters: obj({}),
        replay: "safe",
        execute: () =>
          guarded(async () => {
            const list = await artifacts.list();
            if (list.length === 0) return ok("No repositories yet.");
            return ok(
              list
                .map(
                  (repo) =>
                    `${repo.name} (default ${repo.defaultBranch}, last push ${repo.lastPushAt ?? "never"}${repo.source ? `, from ${repo.source}` : ""})`,
                )
                .join("\n"),
            );
          }),
      }),
    ],
  };
}

function textOf(result: ReturnType<typeof ok>): string {
  return (result.output ?? []).map((part) => ("text" in part ? part.text : "")).join("");
}

export function artifactsSessionId(session: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(session) && !session.includes("__")) return session;
  return `s-${session.replace(/_+/g, "-").replace(/[^A-Za-z0-9._-]/g, "-")}`;
}
