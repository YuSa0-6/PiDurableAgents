import type { Workspace } from "@cloudflare/computer";
import { defineTool, type Extension, type ToolExecutionResult, type ToolRegistration } from "@earendil-works/pi-durable";
import { obj, opt, str } from "@earendil-works/pi-schema";
import {
  GITHUB_API,
  GitHubApp,
  gitHeaders,
  githubHeaders,
  type Fetch,
  type RepoRef
} from "../github/app";

/**
 * pi extension: work on GitHub repositories through a GitHub App.
 *
 * Rules the tools enforce, whatever the model asks:
 * - only repositories on the allowlist (`GITHUB_REPOS`);
 * - push only the current branch, to the branch of the same name, and only
 *   branches under `agent/`; no force push, no delete, no other remote ref;
 * - the App's token goes only into request headers. It is never written to
 *   the workspace (so `exec` cannot read it) or returned to the model.
 */

export const BRANCH_PREFIX = "agent/";
const BRANCH_PATTERN = /^agent\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const COMMIT_AUTHOR = { name: "d1agents-bot", email: "d1agents-bot@users.noreply.github.com" };

/** The parts of the Worker's env this extension reads. */
export type GitHubEnv = {
  readonly GITHUB_APP_ID?: string;
  readonly GITHUB_APP_INSTALLATION_ID?: string;
  readonly GITHUB_APP_PRIVATE_KEY?: string;
  readonly GITHUB_REPOS?: string;
  readonly API_TOKEN?: string;
};

export type GitHubSetup = {
  readonly app: Pick<GitHubApp, "token">;
  /** Allowed repositories, `owner/name`, lowercased. */
  readonly repos: readonly string[];
  readonly fetch: Fetch;
};

/**
 * The GitHub setup when everything it needs is configured, else `undefined`.
 * It also needs `API_TOKEN`: without API auth, anyone with the URL could
 * make the bot push.
 */
export function githubSetup(env: GitHubEnv, fetchImpl: Fetch = fetch): GitHubSetup | undefined {
  const appId = env.GITHUB_APP_ID?.trim();
  const installationId = env.GITHUB_APP_INSTALLATION_ID?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  const repos = parseRepos(env.GITHUB_REPOS ?? "");
  if (!appId || !installationId || !privateKey || repos.length === 0) return undefined;
  if (!env.API_TOKEN) {
    console.warn("GitHub tools are off: set API_TOKEN so the API is not open to anyone");
    return undefined;
  }
  return {
    app: new GitHubApp({ appId, installationId, privateKey }, fetchImpl),
    repos,
    fetch: fetchImpl
  };
}

export function parseRepos(list: string): string[] {
  return list
    .split(",")
    .map((repo) => repo.trim().toLowerCase())
    .filter((repo) => /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(repo));
}

const RepoParam = str({ description: "Repository as owner/name, e.g. YuSa0-6/D1Agents." });
const DirParam = str({ description: "The repository's working tree, an absolute path under /workspace." });

const CloneParameters = obj({
  repo: RepoParam,
  dir: opt(str({ description: "Where to clone. Default: /workspace/<name>." })),
  ref: opt(str({ description: "Branch, tag or commit. Default: the default branch." }))
});
const BranchParameters = obj({
  dir: DirParam,
  name: str({ description: `New branch name. Must start with ${BRANCH_PREFIX}, e.g. agent/fix-typo.` })
});
const CommitParameters = obj({
  dir: DirParam,
  message: str({ description: "Commit message: a short summary line, a blank line, then details." })
});
const PushParameters = obj({ repo: RepoParam, dir: DirParam });
const PullRequestParameters = obj({
  repo: RepoParam,
  branch: str({ description: `The pushed branch (${BRANCH_PREFIX}...) to propose.` }),
  title: str({ description: "Pull request title." }),
  body: opt(str({ description: "Pull request description in Markdown." })),
  base: opt(str({ description: "Branch to merge into. Default: the repository's default branch." }))
});

export function createGitHubExtension(workspace: Workspace, setup: GitHubSetup): Extension {
  const git = workspace.git;

  /** Resolve `repo` against the allowlist, or explain the refusal. */
  const allowed = (repo: string): RepoRef => {
    const normal = repo.trim().toLowerCase();
    if (!setup.repos.includes(normal)) {
      throw new Refusal(
        `${repo} is not an allowed repository. Allowed: ${setup.repos.join(", ")}.`
      );
    }
    const [owner, name] = repo.trim().split("/");
    return { owner, name };
  };

  const branchOf = async (dir: string): Promise<string> => {
    const branch = await git.currentBranch({ dir });
    if (!branch) throw new Refusal(`${dir} is not on a branch (detached HEAD).`);
    return branch;
  };

  const requireAgentBranch = (branch: string): void => {
    if (!BRANCH_PATTERN.test(branch) || branch.split("/").some((part) => /^\.+$/.test(part) || part.endsWith(".lock"))) {
      throw new Refusal(
        `Branch ${branch} is not allowed. Work on a branch under ${BRANCH_PREFIX}, ` +
          "created with git_branch; the default branch is never pushed."
      );
    }
  };

  const api = async (token: string, path: string, init: RequestInit = {}): Promise<Response> =>
    setup.fetch(`${GITHUB_API}${path}`, {
      ...init,
      headers: { ...githubHeaders(token), "content-type": "application/json" }
    });

  const tools: ToolRegistration[] = [
    defineTool({
      name: "github_clone",
      description:
        "Clone an allowed GitHub repository into the workspace with the GitHub App's access. Use this, not exec, for repositories you will push to.",
      parameters: CloneParameters,
      replay: "unsafe",
      execute: (args) =>
        guarded(async () => {
          const { repo, dir, ref } = args;
        const target = allowed(repo);
        const where = workspacePath(dir ?? `/workspace/${target.name}`);
        const token = await setup.app.token(target);
        return redacting(token, async () => {
          await git.clone({
            url: cloneUrl(target),
            dir: where,
            ...(ref ? { ref } : {}),
            headers: gitHeaders(token)
          });
          return ok(`Cloned ${target.owner}/${target.name} into ${where} on ${await branchOf(where)}.`);
        });
      })
    }),
    defineTool({
      name: "git_branch",
      description: `Create a branch under ${BRANCH_PREFIX} from HEAD and switch to it. Do this before committing.`,
      parameters: BranchParameters,
      replay: "unsafe",
      execute: (args) =>
        guarded(async () => {
          const { dir, name } = args;
        const where = workspacePath(dir);
        requireAgentBranch(name);
        await git.branch({ dir: where, name, checkout: true });
        return ok(`Created ${name} in ${where} and switched to it.`);
      })
    }),
    defineTool({
      name: "git_commit",
      description: "Stage every change in the working tree (new, modified and deleted files) and commit it.",
      parameters: CommitParameters,
      replay: "unsafe",
      execute: (args) =>
        guarded(async () => {
          const { dir, message } = args;
        const where = workspacePath(dir);
        await git.add({ dir: where, paths: [], all: true });
        const staged = (await git.status({ dir: where })).filter((entry) => entry.index !== " ");
        if (staged.length === 0) return fail("Nothing to commit: the working tree matches HEAD.");
        const { oid } = await git.commit({ dir: where, message, author: COMMIT_AUTHOR });
        return ok(
          `Committed ${staged.length} file(s) on ${await branchOf(where)} as ${oid.slice(0, 7)}.`
        );
      })
    }),
    defineTool({
      name: "git_push",
      description: `Push the current branch (it must be under ${BRANCH_PREFIX}) to the same branch on GitHub.`,
      parameters: PushParameters,
      replay: "unsafe",
      execute: (args) =>
        guarded(async () => {
          const { repo, dir } = args;
        const target = allowed(repo);
        const where = workspacePath(dir);
        const branch = await branchOf(where);
        requireAgentBranch(branch);
        const token = await setup.app.token(target);
        return redacting(token, async () => {
          // The remote ref is the current branch's own name: no other target, no force, no delete.
          const result = await git.push({
            dir: where,
            url: cloneUrl(target),
            ref: branch,
            remoteRef: branch,
            headers: gitHeaders(token)
          });
          if (!result.ok) return fail(`Push of ${branch} failed: ${result.error ?? "unknown error"}`);
          return ok(`Pushed ${branch} to ${target.owner}/${target.name}.`);
        });
      })
    }),
    defineTool({
      name: "create_pull_request",
      description:
        "Open a draft pull request from a pushed agent/ branch. If one is already open for the branch, return it.",
      parameters: PullRequestParameters,
      replay: "unsafe",
      execute: (args) =>
        guarded(async () => {
          const { repo, branch, title, body, base } = args;
        const target = allowed(repo);
        requireAgentBranch(branch);
        const token = await setup.app.token(target);
        return redacting(token, async () => {
          const path = `/repos/${target.owner}/${target.name}`;
          // Idempotent: a retried call finds the pull request it opened.
          const open = await api(
            token,
            `${path}/pulls?state=open&head=${encodeURIComponent(`${target.owner}:${branch}`)}`
          );
          if (!open.ok) return fail(`Listing pull requests failed (HTTP ${open.status}).`);
          const existing = (await open.json()) as PullRequest[];
          if (existing.length > 0) {
            return ok(`Pull request #${existing[0].number} is already open: ${existing[0].html_url}`);
          }
          let into = base;
          if (!into) {
            const info = await api(token, path);
            if (!info.ok) return fail(`Reading ${repo} failed (HTTP ${info.status}).`);
            into = ((await info.json()) as { default_branch: string }).default_branch;
          }
          const create = (draft: boolean) =>
            api(token, `${path}/pulls`, {
              method: "POST",
              body: JSON.stringify({ title, head: branch, base: into, body: body ?? "", draft })
            });
          let created = await create(true);
          // Draft pull requests need a paid plan on some private repositories.
          if (created.status === 422 && /draft/i.test(await created.clone().text())) {
            created = await create(false);
          }
          if (!created.ok) {
            return fail(`Opening the pull request failed (HTTP ${created.status}): ${await created.text()}`);
          }
          const pr = (await created.json()) as PullRequest;
          return ok(`Opened pull request #${pr.number}${pr.draft ? " (draft)" : ""}: ${pr.html_url}`);
        });
      })
    })
  ];

  return {
    name: "github",
    sections: [
      {
        key: "github",
        render: () =>
          [
            `You can change these GitHub repositories: ${setup.repos.join(", ")}.`,
            "To change one: github_clone it, git_branch to a new branch under agent/, edit files, check your work,",
            "git_commit, git_push, then create_pull_request with a title and a description of what changed and why.",
            "You cannot push the default branch or force push. Do not try to push or open pull requests with exec."
          ].join(" "),
        tag: false
      }
    ],
    tools
  };
}

type PullRequest = { number: number; html_url: string; draft?: boolean };

/** A rule the tool enforces; reported to the model as a tool error, not a crash. */
class Refusal extends Error {}

function cloneUrl(repo: RepoRef): string {
  // Credentials go in headers only: a URL with a token would be saved in .git/config.
  return `https://github.com/${repo.owner}/${repo.name}.git`;
}

/** An absolute path inside /workspace, normalised; anything else is refused. */
export function workspacePath(path: string): string {
  if (!path.startsWith("/")) throw new Refusal(`${path} is not an absolute path.`);
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") throw new Refusal(`${path} must not contain "..".`);
    parts.push(part);
  }
  const normal = `/${parts.join("/")}`;
  if (parts[0] !== "workspace" || parts.length < 2) {
    throw new Refusal(`${path} is not inside /workspace.`);
  }
  return normal;
}

function ok(text: string): ToolExecutionResult {
  return { output: [{ type: "text", text }] };
}

function fail(text: string): ToolExecutionResult {
  return { output: [{ type: "text", text }], isError: true };
}

/** Report refusals and errors to the model as tool errors. */
async function guarded(run: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult> {
  try {
    return await run();
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** Run `work`, removing `token` (raw and as git's Basic credential) from any result or error. */
async function redacting(
  token: string,
  work: () => Promise<ToolExecutionResult>
): Promise<ToolExecutionResult> {
  const secrets = [token, btoa(`x-access-token:${token}`)];
  const scrub = (text: string) =>
    secrets.reduce((out, secret) => out.replaceAll(secret, "[redacted]"), text);
  let result: ToolExecutionResult;
  try {
    result = await work();
  } catch (error) {
    result = fail(error instanceof Error ? error.message : String(error));
  }
  return {
    ...result,
    output: (result.output ?? []).map((part) =>
      part.type === "text" ? { ...part, text: scrub(part.text) } : part
    )
  };
}
