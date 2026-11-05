// Inline the built UI (dist/client) into the Worker bundle, for deploys where
// Workers Static Assets cannot be uploaded.
//
// Why: the asset upload API authenticates with a one-time JWT in the
// `Authorization` header. A network proxy that injects its own Cloudflare API
// token into that header (as some sandboxes do) makes the upload fail with
// 401, while the Worker upload itself works. This script removes `assets`
// from the built config and serves the same files from the Worker instead.
//
// Usage (after `vp build`):
//   node scripts/embed-ui.mjs
//   wrangler deploy -c dist/d1agents_pi_durable/wrangler.embedded.json
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const clientDir = path.join(root, "dist/client");
const workerDir = path.join(root, "dist/d1agents_pi_durable");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm"
};
const TEXT = new Set([".html", ".js", ".css", ".json", ".svg"]);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const files = {};
for (const file of await walk(clientDir)) {
  const rel = "/" + path.relative(clientDir, file).split(path.sep).join("/");
  if (rel === "/.assetsignore") continue;
  const ext = path.extname(file);
  const bytes = await readFile(file);
  files[rel] = TEXT.has(ext)
    ? { type: TYPES[ext], text: bytes.toString("utf8") }
    : { type: TYPES[ext] ?? "application/octet-stream", base64: bytes.toString("base64") };
}

await writeFile(
  path.join(workerDir, "ui-assets.js"),
  `export default ${JSON.stringify(files)};\n`
);

// A thin entry around the built Worker: UI files first, everything else to
// the Hono app. Hashed files under /assets/ are immutable.
await writeFile(
  path.join(workerDir, "embedded.js"),
  `import worker from "./index.js";
import files from "./ui-assets.js";
export * from "./index.js";

function body(file) {
  if (file.text !== undefined) return file.text;
  return Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isApi = url.pathname.startsWith("/api/") || url.pathname.startsWith("/agents/");
    if (!isApi && (request.method === "GET" || request.method === "HEAD")) {
      // Single-page app: unknown paths get index.html.
      const file = files[url.pathname] ?? files["/index.html"];
      const immutable = url.pathname.startsWith("/assets/") && files[url.pathname];
      return new Response(request.method === "HEAD" ? null : body(file), {
        headers: {
          "content-type": file.type,
          "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache"
        }
      });
    }
    return worker.fetch(request, env, ctx);
  }
};
`
);

const config = JSON.parse(
  await readFile(path.join(workerDir, "wrangler.json"), "utf8")
);
delete config.assets;
config.main = "embedded.js";
config.no_bundle = true;
config.find_additional_modules = true;
await writeFile(
  path.join(workerDir, "wrangler.embedded.json"),
  JSON.stringify(config, null, 2)
);

console.log(
  `Embedded ${Object.keys(files).length} UI files into ${path.relative(root, workerDir)}/ui-assets.js`
);
