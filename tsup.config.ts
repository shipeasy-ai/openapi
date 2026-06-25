import { defineConfig } from "tsup";

export default defineConfig({
  // Schemas live here too (src/schemas/*) and are exposed at the
  // `@shipeasy/openapi/schemas/*` subpath — zod-only, no transport/client code,
  // so the server (@shipeasy/core) can re-export them without pulling in the
  // HTTP client. The package has no `@shipeasy/*` deps, so nothing to inline.
  entry: [
    "src/index.ts",
    "src/transport.ts",
    "src/resources/*.ts",
    "src/schemas/*.ts",
    "!src/schemas/*.test.ts",
    "src/operations/*.ts",
    "!src/operations/*.test.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  target: "es2022",
  sourcemap: false,
  splitting: false,
});
