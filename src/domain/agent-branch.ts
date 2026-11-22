import { Refusal } from "./errors";

export const BRANCH_PREFIX = "agent/";

const BRANCH_PATTERN = /^agent\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export function requireAgentBranch(branch: string): void {
  const badPart = branch.split("/").some((part) => /^\.+$/.test(part) || part.endsWith(".lock"));
  if (!BRANCH_PATTERN.test(branch) || badPart) {
    throw new Refusal(
      `Branch ${branch} is not allowed. Work on a branch under ${BRANCH_PREFIX}, ` +
        "created with git_branch; the default branch is never pushed.",
    );
  }
}
