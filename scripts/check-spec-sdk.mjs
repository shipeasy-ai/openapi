#!/usr/bin/env node
/**
 * Contract guard: prove `openapi.json` still generates a clean, strict-compiling
 * SDK. This is the regression gate behind "publish the spec for SDK generation"
 * — `build.test.ts` locks the normalization invariants in-process, but only an
 * actual generate + `tsc` catches a *new* class of generator-hostile construct
 * as the spec grows.
 *
 * Steps:
 *   1. Re-emit the spec and assert it's committed-current (no drift between the
 *      resource Zod schemas and the checked-in openapi.json).
 *   2. Generate a `typescript-fetch` SDK with the real openapi-generator
 *      (needs Java + network; CI installs both).
 *   3. Type-check the generated SDK under `--strict`.
 *
 * Run: `pnpm --filter @shipeasy/openapi check:spec-sdk`
 * Any non-zero step fails the build.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgRoot = fileURLToPath(new URL("..", import.meta.url));
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: pkgRoot, stdio: "inherit", ...opts });

function step(msg) {
  console.log(`\n→ ${msg}`);
}

const out = mkdtempSync(join(tmpdir(), "shipeasy-admin-sdk-"));
try {
  step("1/3 re-emit openapi.json and check it's committed-current");
  run("pnpm", ["emit-openapi"]);
  try {
    run("git", ["diff", "--exit-code", "--", "openapi.json"]);
  } catch {
    console.error(
      "\n✗ openapi.json is stale — the resource schemas changed but the spec\n" +
        "  wasn't re-emitted. Run `pnpm --filter @shipeasy/openapi emit-openapi`\n" +
        "  and commit the result.",
    );
    process.exit(1);
  }

  step("2/3 generate a typescript-fetch SDK (validation ON)");
  // modelPropertyNaming=original avoids the generator's `instanceOf` template
  // emitting dual camel/snake property checks that don't satisfy noImplicitAny.
  run("npx", [
    "--yes",
    "@openapitools/openapi-generator-cli",
    "generate",
    "-i",
    "openapi.json",
    "-g",
    "typescript-fetch",
    "-o",
    out,
    "--additional-properties=npmName=@shipeasy/admin-sdk,supportsES6=true,modelPropertyNaming=original",
  ]);

  step("3/3 strict type-check the generated SDK");
  const tsc = require.resolve("typescript/bin/tsc");
  run(process.execPath, [
    tsc,
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--module",
    "nodenext",
    "--moduleResolution",
    "nodenext",
    "--target",
    "es2022",
    "--lib",
    "es2022,dom",
    join(out, "src/index.ts"),
  ]);

  console.log("\n✓ openapi.json generates a clean, strict-compiling SDK.");
} finally {
  rmSync(out, { recursive: true, force: true });
}
