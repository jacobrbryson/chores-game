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
    // Firestore security-rules tests need the Firestore emulator running. They
    // live in tests/rules and have their own config (`npm run test:rules`).
    exclude: ["node_modules/**", "tests/rules/**"],
  },
});
