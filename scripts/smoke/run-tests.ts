import { finish } from "../lib";

const PASS_LINE = "run test passed with exit code 0";
const TIMEOUT_MS = 600_000;

const PROMPT = [
  '/workspace/demo に package.json を作って、scripts.test を "node --test" にしてください。',
  "同じ場所に、1+1 が 2 になることを node:test と node:assert で確かめる test.mjs を作ってください。",
  "そのあと run_tests で dir=/workspace/demo、script=test を実行し、ツールが返した文章の 1 行目だけを、そのまま返してください。",
].join("");

type EventsReply = { result?: { status?: string; text?: string } };

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  finish(false);
}

function headers(token: string): Record<string, string> {
  const base: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const accessId = process.env.CF_ACCESS_CLIENT_ID;
  if (!accessId) return base;
  return {
    ...base,
    "cf-access-client-id": accessId,
    "cf-access-client-secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "",
  };
}

function passed(body: string): boolean {
  try {
    const reply = JSON.parse(body) as EventsReply;
    return reply.result?.status === "done" && (reply.result.text ?? "").includes(PASS_LINE);
  } catch {
    return false;
  }
}

function hintFor(status: number): string {
  if ((status >= 300 && status < 400) || status === 403) {
    return "Cloudflare Access に止められています。CF_ACCESS_CLIENT_ID と CF_ACCESS_CLIENT_SECRET を確かめてください。";
  }
  if (status === 401) return "CLOUDFLARE_ACCOUNT_TOKEN が通りませんでした。";
  return "";
}

const token = process.env.CLOUDFLARE_ACCOUNT_TOKEN;
if (!token) {
  fail(
    "CLOUDFLARE_ACCOUNT_TOKEN がありません。リポジトリの Actions シークレットに入れてください。",
  );
}

const baseUrl = process.env.SMOKE_BASE_URL ?? "https://d1agents-pi-durable.itumens.workers.dev";
const session = process.env.SMOKE_SESSION ?? `smoke-${Date.now()}`;
console.log(`session: ${session}`);

const response = await fetch(`${baseUrl}/api/events`, {
  method: "POST",
  headers: headers(token),
  body: JSON.stringify({ session, text: PROMPT }),
  redirect: "manual",
  signal: AbortSignal.timeout(TIMEOUT_MS),
}).catch((error: unknown) => fail(`Worker に届きませんでした: ${String(error)}`));

const body = await response
  .text()
  .catch((error: unknown) => fail(`返事を読み切れませんでした: ${String(error)}`));
console.log(`HTTP ${response.status}`);
console.log(body);

if (response.status !== 200) fail(`Worker が 200 以外を返しました。${hintFor(response.status)}`);
if (!passed(body)) fail(`返事に '${PASS_LINE}' がありません。上の返事を確かめてください。`);
console.log("run_tests はコンテナでテストを通しました。");
finish(true);
