import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";

const testsDir = import.meta.dirname;

export function workerdTests(include: string[], testTimeout = 30_000) {
  return defineConfig({
    plugins: [
      cloudflareTest({
        wrangler: { configPath: path.join(testsDir, "wrangler.jsonc") },
      }),
    ],
    resolve: {
      dedupe: [
        "@earendil-works/chord",
        "@earendil-works/pi-ai",
        "@earendil-works/pi-durable",
        "@earendil-works/pi-telemetry",
      ],
    },
    test: {
      name: "d1agents",
      include,
      testTimeout,
      hookTimeout: 30_000,
      fsModuleCache: false,
    },
  });
}

export default workerdTests([
  path.join(testsDir, "..", "**/*.test.ts"),
  path.join(testsDir, "../../lint/*.test.ts"),
]);
