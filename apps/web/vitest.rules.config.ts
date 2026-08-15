import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Firestore security-rules tests run against the local Firestore emulator, so
// they are kept out of the default `vitest run` suite (which must stay
// dependency-free). Run them with `npm run test:rules`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/rules/**/*.test.ts"],
    // Rules tests share one emulator project namespace and clear it between
    // cases, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
