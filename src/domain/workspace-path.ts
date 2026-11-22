import { Refusal } from "./errors";

export function workspacePath(path: string): string {
  if (!path.startsWith("/")) throw new Refusal(`${path} is not an absolute path.`);
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") throw new Refusal(`${path} must not contain "..".`);
    parts.push(part);
  }
  if (parts[0] !== "workspace" || parts.length < 2) {
    throw new Refusal(`${path} is not inside /workspace.`);
  }
  return `/${parts.join("/")}`;
}
