import { cloudflare } from "@cloudflare/vite-plugin";
import agents from "agents/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["docs/architecture/*.html"],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    plugins: ["typescript", "import"],
    jsPlugins: ["./lint/clean-architecture.js"],
    rules: {
      "clean-architecture/dependency-rule": "error",
      "clean-architecture/ports-are-types": "error",
      "clean-architecture/no-comments": "error",
      "import/no-cycle": "error",
    },
    overrides: [
      {
        files: ["src/domain/**", "src/usecase/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: [
                    "cloudflare:*",
                    "hono",
                    "hono/*",
                    "@cloudflare/*",
                    "@earendil-works/*",
                    "agents",
                    "agents/*",
                    "@modelcontextprotocol/*",
                    "zod",
                    "node:*",
                  ],
                  message: "Domain and Usecase stay free of frameworks and runtimes.",
                },
              ],
            },
          ],
          "no-restricted-globals": ["error", "Date", "crypto", "fetch", "console"],
        },
      },
    ],
  },
  plugins: [agents(), cloudflare({ inspectorPort: 9242 })],
  staged: {
    "*": "vp check --fix --no-error-on-unmatched-pattern",
  },
  resolve: {
    dedupe: [
      "@earendil-works/chord",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-durable",
      "@earendil-works/pi-telemetry",
    ],
  },
});
