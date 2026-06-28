import { defineConfig } from "@hey-api/openapi-ts";

/**
 * Generates the TypeScript admin SDK from `openapi.json` — the single source of
 * truth. Run via `pnpm gen:sdk`. The output (`src/generated/`) is committed and
 * re-exported from `src/index.ts`; it replaces the hand-written `resources/`
 * client entirely (operations/ deprecation, Phase 2). The fetch client is
 * bundled (no runtime dependency), so consumers configure auth via the exported
 * `createClient`.
 */
export default defineConfig({
  input: "./openapi.json",
  output: { path: "./src/generated", clean: true },
  plugins: ["@hey-api/client-fetch"],
});
