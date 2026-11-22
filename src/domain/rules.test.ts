import { describe, expect, it } from "vite-plus/test";
import { requireAgentBranch } from "./agent-branch";
import { Refusal } from "./errors";
import { nameFromUrl, repoName } from "./repo-name";
import { isSessionId } from "./session-id";
import { workspacePath } from "./workspace-path";

describe("isSessionId", () => {
  it("accepts 1 to 64 letters, digits, _ and -", () => {
    expect(isSessionId("a")).toBe(true);
    expect(isSessionId("A_b-9".padEnd(64, "x"))).toBe(true);
    expect(isSessionId("")).toBe(false);
    expect(isSessionId("x".repeat(65))).toBe(false);
    expect(isSessionId("a.b")).toBe(false);
  });
});

describe("workspacePath", () => {
  it("normalizes paths inside /workspace", () => {
    expect(workspacePath("/workspace/a/./b/")).toBe("/workspace/a/b");
  });

  it.each(["workspace/a", "/workspace/../etc", "/workspace", "/etc/passwd"])(
    "refuses %s",
    (path) => {
      expect(() => workspacePath(path)).toThrow(Refusal);
    },
  );
});

describe("requireAgentBranch", () => {
  it.each(["agent/fix", "agent/a/b.c_d-e"])("allows %s", (branch) => {
    expect(() => requireAgentBranch(branch)).not.toThrow();
  });

  it.each(["main", "agent/", "agent/..", "agent/x.lock", "feature/agent/x", "agent/a b"])(
    "refuses %s",
    (branch) => {
      expect(() => requireAgentBranch(branch)).toThrow(Refusal);
    },
  );
});

describe("repoName", () => {
  it("trims and accepts valid names", () => {
    expect(repoName("  demo.repo_1-x ")).toBe("demo.repo_1-x");
  });

  it.each(["", "-lead", "a__b", "x".repeat(64), "a/b"])("refuses %j", (name) => {
    expect(() => repoName(name)).toThrow(Refusal);
  });

  it("derives a name from a Git URL", () => {
    expect(nameFromUrl("https://github.com/o/my-repo.git")).toBe("my-repo");
    expect(nameFromUrl("https://example.test/")).toBe("repo");
    expect(nameFromUrl("https://example.test/--x")).toBe("x");
  });
});
