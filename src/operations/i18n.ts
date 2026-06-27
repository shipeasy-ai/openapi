import type { AdminClient } from "../resources/index.js";
import type { Operation, OpInput } from "./types.js";
import { str } from "./util.js";

/**
 * i18n operations — the worker-safe API parts of the String Manager. The fs/AST
 * parts (`scan`, `validate`, `install-loader`, `codemod`) and SDK key minting
 * stay hand-written in the fs-having consumers and are NEVER registry ops.
 *
 * `push` is a registry op that takes the keys as a JSON array (insert-only); the
 * CLI additionally keeps a `i18n push <file>` facade that reads + batches a file
 * over the SAME shared `client.i18n.pushKeys` method, so the endpoint contract
 * lives once. `profiles`/`update`/`publish`/`drafts list` are pure API ops.
 */

const I18N = ["i18n"];
const PROFILES = ["i18n", "profiles"];
const DRAFTS = ["i18n", "drafts"];

export const i18nOperations: Operation[] = [
  {
    group: PROFILES,
    name: "list",
    mutates: false,
    summary: "List i18n locale profiles",
    description: "List the project's i18n locale profiles (name, default locale, locales).",
    params: [],
    examples: [{ run: "shipeasy i18n profiles list" }],
    run: (client: AdminClient) => client.i18n.listProfiles(),
  },
  {
    group: PROFILES,
    name: "create",
    mutates: true,
    summary: "Create an i18n locale profile",
    description: "Create an i18n profile (e.g. 'en:prod', 'fr:prod') with one or more locales.",
    params: [
      { name: "name", type: "string", description: "Profile name.", required: true, positional: true },
      { name: "locales", type: "json", description: 'Locales as a JSON array, e.g. \'["fr","fr-CA"]\'. Defaults to ["en"].' },
      { name: "defaultLocale", type: "string", description: "Default locale (defaults to the first locale)." },
    ],
    examples: [
      { run: "shipeasy i18n profiles create en:prod" },
      { note: "Multiple locales with a default", run: 'shipeasy i18n profiles create fr:prod --locales \'["fr","fr-CA"]\' --default-locale fr' },
    ],
    run: (client: AdminClient, i: OpInput) => {
      const locales = (i.locales as string[] | undefined) ?? ["en"];
      return client.i18n.createProfile({
        name: i.name as string,
        locales,
        default_locale: str(i, "defaultLocale") ?? locales[0],
      });
    },
  },
  {
    group: I18N,
    name: "push",
    mutates: true,
    summary: "Add new i18n keys (insert-only)",
    description:
      "Add NEW keys to a profile. Insert-only — existing keys are never overwritten (use " +
      "`i18n update` to change a value). Keys are a JSON array of {key,value}.",
    params: [
      { name: "profile", type: "string", description: "Profile name (e.g. 'en:prod').", required: true },
      { name: "keys", type: "json", description: 'Keys as a JSON array, e.g. \'[{"key":"home.cta","value":"Get started"}]\'.', required: true },
      { name: "chunk", type: "string", description: "Logical grouping for the keys. Defaults to 'default'." },
    ],
    examples: [
      { note: "Add keys to a profile", run: 'shipeasy i18n push --profile en:prod --keys \'[{"key":"home.cta","value":"Get started"}]\'' },
    ],
    run: async (client: AdminClient, i: OpInput) => {
      const profile = await client.i18n.resolveProfile(i.profile as string);
      return client.i18n.pushKeys({
        profile_id: profile.id,
        chunk: str(i, "chunk") ?? "default",
        keys: i.keys as { key: string; value: string }[],
      });
    },
  },
  {
    group: I18N,
    name: "update",
    mutates: true,
    summary: "Update one i18n key's value",
    description:
      "Change the value of a single existing key (the only overwrite path; `push` only adds). " +
      "One key per call.",
    params: [
      { name: "key", type: "string", description: "Key name.", required: true, positional: true },
      { name: "value", type: "string", description: "New value.", required: true, positional: true },
      { name: "profile", type: "string", description: "Profile name (e.g. 'en:prod').", required: true },
      { name: "description", type: "string", description: "Optional description to store with the key." },
    ],
    examples: [
      { note: "Change one key's value", run: "shipeasy i18n update home.cta 'Get started' --profile en:prod" },
    ],
    run: async (client: AdminClient, i: OpInput) => {
      const profile = await client.i18n.resolveProfile(i.profile as string);
      return client.i18n.updateKeyByName(profile.id, i.key as string, {
        value: i.value as string,
        ...(i.description !== undefined ? { description: i.description as string } : {}),
      });
    },
  },
  {
    group: I18N,
    name: "publish",
    mutates: true,
    summary: "Publish a profile chunk to the CDN",
    description: "Publish a profile chunk (rebuilds the KV manifest and purges the CDN).",
    params: [
      { name: "profile", type: "string", description: "Profile name (e.g. 'en:prod').", required: true },
      { name: "chunk", type: "string", description: "Chunk to publish. Defaults to 'default'." },
    ],
    examples: [
      { note: "Publish the default chunk", run: "shipeasy i18n publish --profile en:prod" },
      { note: "Publish a specific chunk", run: "shipeasy i18n publish --profile fr:prod --chunk marketing" },
    ],
    run: async (client: AdminClient, i: OpInput) => {
      const profile = await client.i18n.resolveProfile(i.profile as string);
      return client.i18n.publish(profile.id, { chunk: str(i, "chunk") ?? "default" });
    },
  },
  {
    group: DRAFTS,
    name: "list",
    mutates: false,
    summary: "List staged i18n drafts",
    description:
      "List staged translation drafts. Replaces the `drafts` kind of the deleted MCP generic read.",
    params: [],
    examples: [{ run: "shipeasy i18n drafts list" }],
    run: (client: AdminClient) => client.i18n.listDrafts(),
  },
];
