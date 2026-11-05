import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const uiTestsDir = import.meta.dirname;

// React component tests. They run in Node with a happy-dom document, apart
// from the Workers tests in ../vitest.config.ts, whose runtime has no DOM.
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"]
  },
  test: {
    name: "ui",
    environment: "happy-dom",
    include: [path.join(uiTestsDir, "**/*.test.tsx")],
    // A plain path (relative to the project root) so static analysis sees it.
    setupFiles: ["./src/tests/ui/setup.ts"]
  }
});
