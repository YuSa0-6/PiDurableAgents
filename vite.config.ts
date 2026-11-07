import { cloudflare } from "@cloudflare/vite-plugin";
import agents from "agents/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [agents(), cloudflare({ inspectorPort: 9242 })],
  resolve: {
    // The commit-pinned pi artifacts intentionally omit sibling package
    // dependencies. Resolve every internal pi import from this project's
    // node_modules so one revision supplies all provider and harness types.
    dedupe: [
      "@earendil-works/chord",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-durable",
      "@earendil-works/pi-telemetry"
    ]
  }
});
