import { rmSync } from "node:fs";
import { files, root, runningPid } from "./run-dir";

const pid = runningPid();
if (pid) {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
  console.log(`stopped pid ${pid}`);
}
rmSync(files.pid, { force: true });
rmSync(files.port, { force: true });
console.log(`evidence kept in ${root}/.verify/`);
