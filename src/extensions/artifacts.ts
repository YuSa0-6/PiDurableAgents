import type { Workspace } from "@cloudflare/computer";
import type { ArtifactClient } from "@cloudflare/computer/artifacts";
import { defineTool, type Extension } from "@earendil-works/pi-durable";
import { obj, opt, str } from "@earendil-works/pi-schema";
import {
  BRANCH_PREFIX,
  currentBranch,
  fail,
  guarded,
  ok,
  redacting,
  Refusal,
  requireAgentBranch,
  workspacePath
} from "./git";

/**
 * pi extension: the agent's own git repositories in Cloudflare Artifacts.
 *
 * Each session has its own repositories (the Workspace scopes the Artifacts
 * client to the session). The agent imports a repository from a public Git
 * URL or creates an empty one, clones it into /workspace, works on an
 * `agent/` branch and pushes it back. People read the work with a read token
 * from `GET /api/sessions/:id/repos`.
 *
 * Besides the shared rules in ./git.ts: every operation mints its own token,
 * for one repository and a few minutes, and revokes it when done.
 */

/** The Artifacts client calls this extension makes: `workspace.artifacts`, or a fake in tests. */
export type ArtifactsClient = Pick<
  ArtifactClient,
  "create" | "get" | "list" | "import" | "createToken" | "revokeToken"
>;

/** Seconds a token for one clone or push lives. */
const OPERATION_TOKEN_TTL = 10 * 60;
/** How long to wait for an import to become readable. */
const IMPORT_WAIT_MS = 90_000;
const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

export type ArtifactsOptions = {
  /** Wait between readiness checks of an import; tests shorten it. */
  readonly pollMs?: number;
};

/** HTTP headers for git over HTTPS to Artifacts. */
function gitHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function repoName(name: string): string {
  const trimmed = name.trim();
  if (!REPO_NAME.test(trimmed) || trimmed.includes("__")) {
    throw new Refusal(
      `${name} is not a valid repository name: start with a letter or digit, then letters, digits, ".", "_" or "-" (no "__"), up to 63 characters.`
    );
  }
  return trimmed;
}

/** The repository name a Git URL suggests: its last path segment without `.git`. */
export function nameFromUrl(url: string): string {
  const last = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "repo";
  return last.replace(/\.git$/, "").replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "repo";
}

export function createArtifactsExtension(
  workspace: Workspace,
  artifacts: ArtifactsClient,
  options: ArtifactsOptions = {}
): Extension {
  const git = workspace.git;
  const pollMs = options.pollMs ?? 2_000;

  /** Run `work` with a fresh token for `name`, then revoke it; the token never reaches the output. */
  const withToken = async (
    name: string,
    scope: "read" | "write",
    work: (token: string, remote: string) => Promise<ReturnType<typeof ok>>
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
      // Credentials go in headers only: a URL with a token would be saved in .git/config.
      await git.clone({ url: remote, dir, ...(ref ? { ref } : {}), headers: gitHeaders(token) });
      return ok(`Cloned ${name} into ${dir} on ${await currentBranch(workspace, dir)}.`);
    });

  /** An import is readable once `get` stops throwing. */
  const waitUntilReady = async (name: string): Promise<void> => {
    const deadline = Date.now() + IMPORT_WAIT_MS;
    for (;;) {
      try {
        await artifacts.get(name);
        return;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    }
  };

  /** Revoke the token create() and import() hand back; each operation mints its own. */
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
            "Do not try to push with exec."
          ].join(" "),
        tag: false
      }
    ],
    tools: [
      defineTool({
        name: "repo_import",
        description:
          "Import a public Git repository (HTTPS URL) into this session's Artifacts and clone it into /workspace.",
        parameters: obj({
          url: str({ description: "HTTPS Git URL, e.g. https://github.com/owner/repo." }),
          name: opt(str({ description: "Repository name. Default: from the URL." })),
          branch: opt(str({ description: "Branch to import. Default: the remote's default branch." })),
          dir: opt(str({ description: "Where to clone. Default: /workspace/<name>." }))
        }),
        replay: "unsafe",
        execute: (args) =>
          guarded(async () => {
            const url = new URL(args.url);
            if (url.protocol !== "https:") throw new Refusal("Only HTTPS Git URLs can be imported.");
            const name = repoName(args.name ?? nameFromUrl(args.url));
            const dir = workspacePath(args.dir ?? `/workspace/${name}`);
            const imported = await artifacts.import(name, {
              url: args.url,
              ...(args.branch ? { branch: args.branch } : {})
            });
            await dropInitialToken(name, imported.token);
            await waitUntilReady(name);
            const cloned = await clone(name, dir, args.branch);
            if (cloned.isError) return cloned;
            return ok(`Imported ${args.url} as ${name}. ${textOf(cloned)}`);
          })
      }),
      defineTool({
        name: "repo_create",
        description:
          "Create an empty repository in this session's Artifacts and start a local repository for it in /workspace.",
        parameters: obj({
          name: str({ description: "Repository name: letters, digits, '.', '_' or '-'." }),
          description: opt(str({ description: "One line about the project." })),
          dir: opt(str({ description: "Local directory. Default: /workspace/<name>." }))
        }),
        replay: "unsafe",
        execute: (args) =>
          guarded(async () => {
            const name = repoName(args.name);
            const dir = workspacePath(args.dir ?? `/workspace/${name}`);
            const created = await artifacts.create(name, {
              ...(args.description ? { description: args.description } : {}),
              setDefaultBranch: "main"
            });
            await dropInitialToken(name, created.token);
            await workspace.fs.mkdir(dir, { recursive: true });
            await git.init({ dir, defaultBranch: created.defaultBranch || "main" });
            return ok(
              `Created ${name} and a local repository at ${dir} on ${created.defaultBranch || "main"}. ` +
                `Add files, git_branch to ${BRANCH_PREFIX}..., git_commit, then repo_push.`
            );
          })
      }),
      defineTool({
        name: "repo_clone",
        description: "Clone one of this session's Artifacts repositories into /workspace.",
        parameters: obj({
          name: str({ description: "Repository name, as repo_list shows it." }),
          dir: opt(str({ description: "Where to clone. Default: /workspace/<name>." })),
          ref: opt(str({ description: "Branch, tag or commit. Default: the default branch." }))
        }),
        replay: "unsafe",
        execute: (args) =>
          guarded(async () => {
            const name = repoName(args.name);
            return clone(name, workspacePath(args.dir ?? `/workspace/${name}`), args.ref);
          })
      }),
      defineTool({
        name: "repo_push",
        description: `Push the current branch (it must be under ${BRANCH_PREFIX}) to the same branch of the session's Artifacts repository.`,
        parameters: obj({
          name: str({ description: "Repository name, as repo_list shows it." }),
          dir: str({ description: "The local working tree, an absolute path under /workspace." })
        }),
        replay: "unsafe",
        execute: (args) =>
          guarded(async () => {
            const name = repoName(args.name);
            const dir = workspacePath(args.dir);
            const branch = await currentBranch(workspace, dir);
            requireAgentBranch(branch);
            return withToken(name, "write", async (token, remote) => {
              // The remote ref is the current branch's own name: no other target, no force, no delete.
              const result = await git.push({
                dir,
                url: remote,
                ref: branch,
                remoteRef: branch,
                headers: gitHeaders(token)
              });
              if (!result.ok) return fail(`Push of ${branch} failed: ${result.error ?? "unknown error"}`);
              return ok(`Pushed ${branch} to ${name}.`);
            });
          })
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
                    `${repo.name} (default ${repo.defaultBranch}, last push ${repo.lastPushAt ?? "never"}${repo.source ? `, from ${repo.source}` : ""})`
                )
                .join("\n")
            );
          })
      })
    ]
  };
}

function textOf(result: ReturnType<typeof ok>): string {
  return (result.output ?? []).map((part) => ("text" in part ? part.text : "")).join("");
}

/**
 * The Artifacts scope for a session: its name when Artifacts accepts it as
 * a repository-name prefix, else a sanitised form under `s-`.
 */
export function artifactsSessionId(session: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(session) && !session.includes("__")) return session;
  return `s-${session.replace(/_+/g, "-").replace(/[^A-Za-z0-9._-]/g, "-")}`;
}
