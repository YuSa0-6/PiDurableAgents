import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { git } from "../../../../scripts/lib";

export const root = git("rev-parse", "--show-toplevel") || process.cwd();
export const runDir = path.join(root, ".verify", "run");
export const files = {
  pid: path.join(runDir, "pid"),
  port: path.join(runDir, "port"),
  devLog: path.join(runDir, "dev.log"),
  calls: path.join(runDir, "calls.log"),
};

export function ensureRunDir() {
  mkdirSync(runDir, { recursive: true });
}

export function readText(file: string) {
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
}

export function runningPid() {
  const pid = Number(readText(files.pid));
  if (!pid) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

export function baseUrl() {
  const port = readText(files.port);
  return port ? `http://localhost:${port}` : null;
}

export async function status(url: string, init: RequestInit = {}) {
  try {
    return (await fetch(url, { ...init, redirect: "manual" })).status;
  } catch {
    return 0;
  }
}
