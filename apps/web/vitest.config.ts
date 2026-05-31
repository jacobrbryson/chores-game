import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@packages/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@packages/locales": fileURLToPath(new URL("./packages/locales/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});
