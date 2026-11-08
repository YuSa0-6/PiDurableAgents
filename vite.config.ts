import { cloudflare } from "@cloudflare/vite-plugin";
import agents from "agents/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [agents(), cloudflare({ inspectorPort: 9242 })],
  resolve: {
    dedupe: [
      "@earendil-works/chord",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-durable",
      "@earendil-works/pi-telemetry"
    ]
  }
});
