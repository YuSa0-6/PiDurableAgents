import { readFileSync } from "node:fs";
import { finish, run } from "../lib";

const config = ".cloudflare/output/v0/workers/default/worker.config.json";
if (!run(["bun", "run", "build"]).ok) finish(false);
if (readFileSync(config, "utf8").includes("SKIP_AUTH_ON_LOCALHOST")) {
  process.stderr.write(
    `SKIP_AUTH_ON_LOCALHOST is in ${config}. Deploy builds must not use --mode verify.\n`,
  );
  finish(false);
}
console.log("deploy build has no local auth bypass");
finish(true);
