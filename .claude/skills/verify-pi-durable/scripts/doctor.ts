import { finish, git } from "../../../../scripts/lib";
import { baseUrl, runningPid, status } from "./run-dir";

let ok = true;
const pid = runningPid();
console.log(
  pid ? `process: ok (pid ${pid}, started by launch.ts)` : "process: not running. run launch.ts",
);
ok &&= pid !== null;

const base = baseUrl();
if (base) {
  const health = await status(`${base}/api/health`);
  console.log(`/api/health without a token: ${health} (want 200 in verify mode)`);
  ok &&= health === 200;
} else {
  console.log("port: unknown");
  ok = false;
}

for (const name of ["CLOUDFLARE_ACCESS_CLIENT_ID", "CLOUDFLARE_ACCESS_CLIENT_SECRET"]) {
  if (!process.env[name]) {
    console.log(`${name}: missing (remote AI and Artifacts will be blocked by Access)`);
    ok = false;
  }
}
console.log(`commit: ${git("rev-parse", "HEAD")}`);
finish(ok);
