import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/transport.ts", "src/resources/*.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  target: "es2022",
  sourcemap: false,
  splitting: false,
  // @shipeasy/core ships TS source only (no build step) — inline it so the
  // admin-api dist is self-contained and Node's runtime ESM resolver never
  // hits a .ts file when this package is consumed by built packages
  // (@shipeasy/mcp, @shipeasy/cli).
  noExternal: ["@shipeasy/core"],
});
