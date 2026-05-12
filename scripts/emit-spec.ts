#!/usr/bin/env tsx
/**
 * Generates `packages/openapi/openapi.json` from the resource registry.
 * Run via `pnpm --filter @shipeasy/openapi emit-openapi`. The output file
 * is checked in so reviewers can diff spec changes alongside resource edits;
 * CI may also re-emit and assert that no diff results.
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApi } from "../src/openapi/index.js";
import { gatesResource } from "../src/resources/gates.js";
import { configsResource } from "../src/resources/configs.js";
import { experimentsResource } from "../src/resources/experiments.js";
import { universesResource } from "../src/resources/universes.js";
import { killswitchesResource } from "../src/resources/killswitches.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT = join(__dirname, "..", "openapi.json");

const doc = buildOpenApi({
  info: {
    title: "Shipeasy Admin API",
    version: "1.0.0",
    description:
      'REST API for managing feature gates, experiments, configs, universes, and killswitches in a Shipeasy project. Authenticate with an admin SDK key (`Authorization: Bearer sdk_admin_…`) and scope every request to a project via the `X-Project-Id` header.\n\nMint admin keys via `POST /api/admin/keys` with `type: "admin"`. Keys expire after 90 days; rotate with the `revoke` action.',
    contact: { name: "Shipeasy", url: "https://shipeasy.ai" },
    license: { name: "Proprietary" },
  },
  servers: [
    { url: "https://shipeasy.ai", description: "Production" },
    { url: "http://localhost:3000", description: "Local Next.js dev server" },
  ],
  resources: [
    gatesResource,
    experimentsResource,
    configsResource,
    killswitchesResource,
    universesResource,
  ],
});

writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
console.log(
  `wrote ${OUT}: ${Object.keys(doc.paths ?? {}).length} paths, ${
    Object.keys(doc.components?.schemas ?? {}).length
  } schemas`,
);
