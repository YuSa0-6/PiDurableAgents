import { appendFileSync } from "node:fs";
import { baseUrl, files } from "./run-dir";

const [method = "", target = "", body = ""] = process.argv.slice(2);
const base = baseUrl();
if (!method || !target || !base) {
  process.stderr.write(
    "usage: bun call.ts <GET|POST|MCP> <path|mcp method> [json]. run launch.ts first\n",
  );
  process.exit(2);
}

const token = process.env.CLOUDFLARE_ACCOUNT_TOKEN;
const headers: Record<string, string> = { "content-type": "application/json" };
if (token) headers.authorization = `Bearer ${token}`;

const request: { url: string; init: RequestInit } =
  method === "MCP"
    ? {
        url: `${base}/mcp`,
        init: {
          method: "POST",
          headers: { ...headers, accept: "application/json, text/event-stream" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: target,
            params: JSON.parse(body || "{}"),
          }),
        },
      }
    : { url: `${base}${target}`, init: { method, headers, body: body || undefined } };

const response = await fetch(request.url, request.init);
const text = `${await response.text()}\nstatus: ${response.status}`;
const redacted = redact(text);
appendFileSync(
  files.calls,
  `### ${method} ${target}\n${body ? `body: ${body}\n` : ""}${redacted}\n\n`,
);
console.log(redacted);

function redact(value: string) {
  const masked = token ? value.split(token).join("<redacted>") : value;
  return masked.replace(/("token"\s*:\s*")[^"]+/g, "$1<redacted>");
}
