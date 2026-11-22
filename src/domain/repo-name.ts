import { Refusal } from "./errors";

const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

export function repoName(name: string): string {
  const trimmed = name.trim();
  if (!REPO_NAME.test(trimmed) || trimmed.includes("__")) {
    throw new Refusal(
      `${name} is not a valid repository name: start with a letter or digit, then letters, digits, ".", "_" or "-" (no "__"), up to 63 characters.`,
    );
  }
  return trimmed;
}

export function nameFromUrl(url: string): string {
  const last = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "repo";
  return (
    last
      .replace(/\.git$/, "")
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .replace(/^[^A-Za-z0-9]+/, "") || "repo"
  );
}
