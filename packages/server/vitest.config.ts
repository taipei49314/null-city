import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@null-city/contracts/truth": fileURLToPath(new URL("../contracts/src/truth-entry.ts", import.meta.url)),
      "@null-city/contracts": fileURLToPath(new URL("../contracts/src/index.ts", import.meta.url)),
      "@null-city/scenario-schema": fileURLToPath(
        new URL("../scenario-schema/src/index.ts", import.meta.url),
      ),
      "@null-city/simulation": fileURLToPath(
        new URL("../simulation/src/index.ts", import.meta.url),
      ),
      "@null-city/epistemics": fileURLToPath(
        new URL("../epistemics/src/index.ts", import.meta.url),
      ),
      "@null-city/test-fixtures": fileURLToPath(
        new URL("../test-fixtures/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});