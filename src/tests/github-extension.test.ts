import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";
import { githubSetup, parseRepos, workspacePath } from "../extensions/github";
import { FAKE_TOKEN } from "./worker";

const REPO = "YuSa0-6/D1Agents";
const DIR = "/workspace/d1agents";

function object() {
  return env.PI_HARNESS_TEST.getByName(crypto.randomUUID());
}

describe("the github extension's setup", () => {
  const configured = {
    GITHUB_APP_ID: "1",
    GITHUB_APP_INSTALLATION_ID: "2",
    GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nAA==\n-----END RSA PRIVATE KEY-----",
    GITHUB_REPOS: "YuSa0-6/D1Agents, bad repo, other/Repo",
    API_TOKEN: "secret"
  };

  it("is on when the App, the repositories and API_TOKEN are all set", () => {
    expect(githubSetup(configured)?.repos).toEqual(["yusa0-6/d1agents", "other/repo"]);
  });

  it("stays off without API_TOKEN, so an open API cannot push", () => {
    expect(githubSetup({ ...configured, API_TOKEN: "" })).toBeUndefined();
  });

  it("stays off until the App is configured", () => {
    expect(githubSetup({ ...configured, GITHUB_APP_ID: "" })).toBeUndefined();
    expect(githubSetup({ ...configured, GITHUB_APP_PRIVATE_KEY: undefined })).toBeUndefined();
    expect(parseRepos("")).toEqual([]);
  });

  it("calls the real fetch the way workerd allows", async () => {
    // A stored global fetch called as a method throws "Illegal invocation".
    const setup = githubSetup(configured)!;
    const error = await setup.fetch("http://127.0.0.1:1/").then(
      () => undefined,
      (reason: unknown) => String(reason)
    );
    expect(error ?? "").not.toMatch(/Illegal invocation/);
  });

  it("keeps paths inside /workspace", () => {
    expect(workspacePath("/workspace/a/./b/")).toBe("/workspace/a/b");
    expect(() => workspacePath("/workspace/../etc")).toThrow();
    expect(() => workspacePath("/workspace")).toThrow();
    expect(() => workspacePath("workspace/a")).toThrow();
  });
});

describe("the github tools", () => {
  it("branch under agent/ and commit every change", async () => {
    const stub = object();
    await stub.gitRepo(DIR);
    expect((await stub.githubTool("git_branch", { dir: DIR, name: "agent/fix-readme" })).isError).toBe(false);
    await stub.writeWorkspaceFile(`${DIR}/README.md`, "hello, world\n");
    await stub.writeWorkspaceFile(`${DIR}/NEW.md`, "new\n");
    const commit = await stub.githubTool("git_commit", { dir: DIR, message: "Fix the README" });
    expect(commit).toMatchObject({ isError: false });
    expect(commit.text).toMatch(/^Committed 2 file\(s\) on agent\/fix-readme as [0-9a-f]{7}\.$/);
    expect(await stub.gitLog(DIR)).toEqual(["Fix the README", "init"]);
  });

  it("report a commit with nothing to commit as an error", async () => {
    const stub = object();
    await stub.gitRepo(DIR);
    expect(await stub.githubTool("git_commit", { dir: DIR, message: "empty" })).toMatchObject({ isError: true });
  });

  it("refuse branches outside agent/", async () => {
    const stub = object();
    await stub.gitRepo(DIR);
    for (const name of ["main", "feature/x", "agent/..", "agent/a/../b", "agent/x.lock"]) {
      expect((await stub.githubTool("git_branch", { dir: DIR, name })).isError).toBe(true);
    }
  });

  it("refuse to push the default branch, before asking for a token", async () => {
    const stub = object();
    await stub.gitRepo(DIR);
    const push = await stub.githubTool("git_push", { repo: REPO, dir: DIR });
    expect(push.isError).toBe(true);
    expect(push.text).toContain("Branch main is not allowed");
    expect((await stub.githubCalls()).tokens).toEqual([]);
  });

  it("refuse repositories outside the allowlist, before asking for a token", async () => {
    const stub = object();
    for (const [name, args] of [
      ["github_clone", { repo: "someone/else" }],
      ["git_push", { repo: "someone/else", dir: DIR }],
      ["create_pull_request", { repo: "someone/else", branch: "agent/x", title: "t" }]
    ] as const) {
      const result = await stub.githubTool(name, args);
      expect(result.isError).toBe(true);
      expect(result.text).toContain("not an allowed repository");
    }
    expect((await stub.githubCalls()).tokens).toEqual([]);
  });

  it("open a draft pull request once, and return it when asked again", async () => {
    const stub = object();
    const args = { repo: REPO, branch: "agent/fix-readme", title: "Fix the README", body: "Why" };
    const first = await stub.githubTool("create_pull_request", args);
    expect(first).toEqual({ isError: false, text: "Opened pull request #1 (draft): https://github.com/o/r/pull/1" });
    const again = await stub.githubTool("create_pull_request", args);
    expect(again.text).toBe("Pull request #1 is already open: https://github.com/o/r/pull/1");

    const { requests, tokens } = await stub.githubCalls();
    expect(tokens).toEqual([REPO, REPO]);
    // The REST API gets the token as a Bearer header; the model never sees it.
    expect(requests.every((request) => request.endsWith(`Bearer ${FAKE_TOKEN}`))).toBe(true);
    expect(requests.map((request) => request.split(" ").slice(0, 2).join(" "))).toEqual([
      "GET /repos/YuSa0-6/D1Agents/pulls?state=open&head=YuSa0-6%3Aagent%2Ffix-readme",
      "GET /repos/YuSa0-6/D1Agents",
      "POST /repos/YuSa0-6/D1Agents/pulls",
      "GET /repos/YuSa0-6/D1Agents/pulls?state=open&head=YuSa0-6%3Aagent%2Ffix-readme"
    ]);
    expect(first.text + again.text).not.toContain(FAKE_TOKEN);
  });
});
