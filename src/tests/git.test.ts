import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";
import { workspacePath } from "../extensions/git";

const DIR = "/workspace/demo";

function object() {
  return env.PI_HARNESS_TEST.getByName(crypto.randomUUID());
}

describe("the git extension", () => {
  it("keeps paths inside /workspace", () => {
    expect(workspacePath("/workspace/a/./b/")).toBe("/workspace/a/b");
    expect(() => workspacePath("/workspace/../etc")).toThrow();
    expect(() => workspacePath("/workspace")).toThrow();
    expect(() => workspacePath("workspace/a")).toThrow();
  });

  it("branches under agent/ and commits every change", async () => {
    const stub = object();
    await stub.gitRepo(DIR);
    expect((await stub.runTool("git_branch", { dir: DIR, name: "agent/fix-readme" })).isError).toBe(false);
    await stub.writeWorkspaceFile(`${DIR}/README.md`, "hello, world\n");
    await stub.writeWorkspaceFile(`${DIR}/NEW.md`, "new\n");
    const commit = await stub.runTool("git_commit", { dir: DIR, message: "Fix the README" });
    expect(commit).toMatchObject({ isError: false });
    expect(commit.text).toMatch(/^Committed 2 file\(s\) on agent\/fix-readme as [0-9a-f]{7}\.$/);
    expect(await stub.gitLog(DIR)).toEqual(["Fix the README", "init"]);
  });

  it("reports a commit with nothing to commit as an error", async () => {
    const stub = object();
    await stub.gitRepo(DIR);
    expect(await stub.runTool("git_commit", { dir: DIR, message: "empty" })).toMatchObject({ isError: true });
  });

  it("refuses branches outside agent/", async () => {
    const stub = object();
    await stub.gitRepo(DIR);
    for (const name of ["main", "feature/x", "agent/..", "agent/a/../b", "agent/x.lock"]) {
      expect((await stub.runTool("git_branch", { dir: DIR, name })).isError).toBe(true);
    }
  });
});
