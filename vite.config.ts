import { cloudflare } from "@cloudflare/vite-plugin";
import agents from "agents/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["docs/architecture/*.html", "docs/upstream-*.md"],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
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
