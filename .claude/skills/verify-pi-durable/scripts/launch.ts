import { spawn } from "node:child_process";
import { openSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { finish, has, run } from "../../../../scripts/lib";
import { ensureRunDir, files, readText, root, runningPid, status } from "./run-dir";

ensureRunDir();
const already = runningPid();
if (already) {
  console.log(`already running: pid ${already}, port ${readText(files.port)}`);
  finish(true);
}

const dockerReady = has("docker") && run(["docker", "info"], { quiet: true }).ok;
const mode = dockerReady ? "verify" : "verify-without-containers";
if (mode !== "verify") console.log("docker is not running: starting without the Sandbox container");
writeFileSync(files.calls, "");
const log = openSync(files.devLog, "w");
const child = spawn("bun", ["run", "start", "--", "--mode", mode], {
  cwd: root,
  detached: true,
  stdio: ["ignore", log, log],
});
child.unref();
writeFileSync(files.pid, String(child.pid));

for (let second = 0; second < 900; second++) {
  const port = /localhost:(\d+)/.exec(readText(files.devLog))?.[1];
  if (port && (await status(`http://localhost:${port}/api/health`)) === 200) {
    writeFileSync(files.port, port);
    console.log(`ready: http://localhost:${port} (pid ${child.pid})`);
    finish(true);
  }
  if (!runningPid()) {
    process.stderr.write(`cf dev exited. last lines of ${files.devLog}:\n`);
    process.stderr.write(`${readText(files.devLog).split("\n").slice(-20).join("\n")}\n`);
    finish(false);
  }
  await sleep(1000);
}
process.stderr.write(`cf dev did not answer within 900s. see ${files.devLog}\n`);
finish(false);
