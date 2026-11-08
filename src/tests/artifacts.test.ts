import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";
import { artifactsSessionId, nameFromUrl } from "../extensions/artifacts";
import { FAKE_ARTIFACTS_TOKEN } from "./worker";

function object() {
  return env.PI_HARNESS_TEST.getByName(crypto.randomUUID());
}

describe("Artifacts names", () => {
  it("scopes a session by its name when Artifacts accepts it, else under s-", () => {
    expect(artifactsSessionId("demo")).toBe("demo");
    expect(artifactsSessionId("cf-deploy-check")).toBe("cf-deploy-check");
    expect(artifactsSessionId("_private")).toBe("s--private");
    expect(artifactsSessionId("a__b")).toBe("s-a-b");
  });

  it("names an import after the URL's last segment", () => {
    expect(nameFromUrl("https://github.com/YuSa0-6/D1Agents")).toBe("D1Agents");
    expect(nameFromUrl("https://github.com/owner/repo.git")).toBe("repo");
  });
});

describe("the artifacts tools", () => {
  it("create a repository and a local one to branch and commit in", async () => {
    const stub = object();
    const created = await stub.runTool("repo_create", { name: "hello", description: "demo" });
    expect(created.isError).toBe(false);
    expect(created.text).toContain("/workspace/hello on main");
    await stub.writeWorkspaceFile("/workspace/hello/README.md", "# hello\n");
    expect((await stub.runTool("git_branch", { dir: "/workspace/hello", name: "agent/start" })).isError).toBe(false);
    const commit = await stub.runTool("git_commit", { dir: "/workspace/hello", message: "Start" });
    expect(commit.text).toMatch(/^Committed 1 file\(s\) on agent\/start as [0-9a-f]{7}\.$/);
    expect(await stub.artifactsCalls()).toEqual(["create hello", "revoke hello initial"]);
  });

  it("refuse to push the default branch, before minting a token", async () => {
    const stub = object();
    await stub.gitRepo("/workspace/demo");
    const push = await stub.runTool("repo_push", { name: "demo", dir: "/workspace/demo" });
    expect(push).toMatchObject({ isError: true });
    expect(push.text).toContain("Branch main is not allowed");
    expect(await stub.artifactsCalls()).toEqual([]);
  });

  it("refuse invalid repository names and paths", async () => {
    const stub = object();
    for (const name of ["a__b", "-x", "../x", "x/y", ""]) {
      expect((await stub.runTool("repo_create", { name })).isError).toBe(true);
    }
    expect((await stub.runTool("repo_create", { name: "ok", dir: "/etc/ok" })).isError).toBe(true);
    expect((await stub.runTool("repo_import", { url: "http://example.com/x.git" })).isError).toBe(true);
    expect(await stub.artifactsCalls()).toEqual([]);
  });

  it("import, wait until the import is readable, and revoke every token", async () => {
    const stub = object();
    const result = await stub.runTool("repo_import", { url: "https://github.com/owner/tool.git" });
    expect(result.isError).toBe(true);
    expect(result.text).not.toContain(FAKE_ARTIFACTS_TOKEN);
    expect(await stub.artifactsCalls()).toEqual([
      "import tool from https://github.com/owner/tool.git",
      "revoke tool initial",
      "get tool (importing)",
      "get tool (importing)",
      "token read tool t1",
      "revoke tool t1"
    ]);
  });

  it("list the session's repositories", async () => {
    const stub = object();
    expect((await stub.runTool("repo_list", {})).text).toBe("No repositories yet.");
    await stub.runTool("repo_create", { name: "one" });
    expect((await stub.runTool("repo_list", {})).text).toBe("one (default main, last push never)");
  });
});
