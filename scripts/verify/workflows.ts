import { finish, has, stream } from "../lib";

function zizmor(): string[] | null {
  if (has("zizmor")) return ["zizmor"];
  if (has("uvx")) return ["uvx", "zizmor@1.32.0"];
  return null;
}

const command = zizmor();
if (!command) {
  process.stderr.write(
    "zizmor も uvx も見つからないので GitHub Actions の検査を飛ばします(CI では必ず実行されます)。\n" +
      "入れ方: brew install zizmor / uv tool install zizmor\n",
  );
  finish(true);
}

finish(stream([...command, "--offline", ...process.argv.slice(2), "."]));
