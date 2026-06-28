import { z } from "zod";
import type { Transport } from "../transport.js";
import { ApiError } from "../transport.js";
import {
  i18nProfileResponseSchema,
  i18nProfileCreateSchema,
  i18nProfileCreateResponseSchema,
  i18nKeyListResponseSchema,
  i18nPushKeysSchema,
  i18nPushResultSchema,
  i18nKeyUpdateSchema,
  i18nKeyUpdateResponseSchema,
  i18nDraftResponseSchema,
  i18nPublishSchema,
  i18nPublishResponseSchema,
} from "../schemas/i18n.js";

/**
 * i18n (String Manager) — the API-only parts that are worker-safe and shared
 * between CLI and MCP: locale profiles, the insert-only key push, single-key
 * update, chunk publish, and the read-only key/draft listings.
 *
 * The fs/AST parts (`scan`, `validate`, `install-loader`, `codemod`) stay
 * hand-written in the fs-having consumers and are NEVER added here — the
 * registry is bundled into a Worker that can't load `node:fs` or the TS AST.
 */
export interface I18nProfile {
  id: string;
  name: string;
  locales?: string[];
  default_locale?: string;
}

export interface I18nKey {
  id: string;
  key: string;
  value?: string;
  [key: string]: unknown;
}

export interface I18nDraft {
  id: string;
  [key: string]: unknown;
}

export interface I18nPushResult {
  added?: string[];
  skipped?: string[];
  pushed_count?: number;
  skipped_count?: number;
}

export interface I18nClient {
  listProfiles(): Promise<I18nProfile[]>;
  createProfile(input: {
    name: string;
    locales?: string[];
    default_locale?: string;
  }): Promise<{ id: string; name: string }>;
  /** Resolve a profile by exact name (the user-facing handle). */
  resolveProfile(name: string): Promise<I18nProfile>;
  /** Insert-only key push (existing keys are left untouched). */
  pushKeys(input: {
    profile_id: string;
    chunk?: string;
    keys: { key: string; value: string }[];
  }): Promise<I18nPushResult>;
  /** List keys for a profile (optionally a name prefix). */
  listKeys(query?: { profile_id?: string; prefix?: string; limit?: number }): Promise<I18nKey[]>;
  /** Update one existing key's value (the only overwrite path). */
  updateKey(id: string, input: { value: string; description?: string }): Promise<{ id: string }>;
  /** Resolve a key by exact name within a profile, then PUT its new value. */
  updateKeyByName(
    profileId: string,
    key: string,
    input: { value: string; description?: string },
  ): Promise<{ id: string }>;
  /** List staged drafts (the read-only `drafts` kind from the old generic read). */
  listDrafts(): Promise<I18nDraft[]>;
  /** Publish a profile chunk (rebuild KV manifest + purge CDN). */
  publish(profileId: string, input: { chunk?: string }): Promise<unknown>;
}

const PROFILES = "/api/admin/i18n/profiles";
const KEYS = "/api/admin/i18n/keys";
const DRAFTS = "/api/admin/i18n/drafts";

export function i18nClient(t: Transport): I18nClient {
  async function listProfiles(): Promise<I18nProfile[]> {
    return t.request<I18nProfile[]>("GET", PROFILES);
  }
  async function resolveProfile(name: string): Promise<I18nProfile> {
    const all = await listProfiles();
    const found = all.find((p) => p.name === name);
    if (!found)
      throw new ApiError(
        `Profile '${name}' not found. Existing: ${all.map((p) => p.name).join(", ") || "(none)"}`,
        404,
      );
    return found;
  }
  async function listKeys(
    query: { profile_id?: string; prefix?: string; limit?: number } = {},
  ): Promise<I18nKey[]> {
    const q: Record<string, string> = {};
    if (query.profile_id) q.profile_id = query.profile_id;
    if (query.prefix) q.prefix = query.prefix;
    if (query.limit !== undefined) q.limit = String(query.limit);
    // The endpoint historically returns either a bare array or `{ keys: [...] }`.
    const res = await t.request<I18nKey[] | { keys: I18nKey[] }>("GET", KEYS, undefined, q);
    return Array.isArray(res) ? res : res.keys;
  }
  function updateKey(id: string, input: { value: string; description?: string }) {
    return t.request<{ id: string }>("PUT", `${KEYS}/${id}`, input);
  }
  return {
    listProfiles,
    resolveProfile,
    listKeys,
    updateKey,
    createProfile: (input) => t.request<{ id: string; name: string }>("POST", PROFILES, input),
    pushKeys: (input) => t.request<I18nPushResult>("POST", KEYS, input),
    updateKeyByName: async (profileId, key, input) => {
      const rows = await listKeys({ profile_id: profileId, prefix: key, limit: 500 });
      const match = rows.find((k) => k.key === key);
      if (!match)
        throw new ApiError(`Key '${key}' not found in profile. Add it first with i18n push.`, 404);
      return updateKey(match.id, input);
    },
    listDrafts: () => t.request<I18nDraft[]>("GET", DRAFTS),
    publish: (profileId, input) =>
      t.request<unknown>("POST", `${PROFILES}/${profileId}/publish`, { chunk: input.chunk ?? "default" }),
  };
}

export const i18nResource = {
  name: "i18n" as const,
  basePath: "/api/admin/i18n",
  describeOne: "i18n key",
  describeMany: "i18n keys",
  tag: {
    name: "i18n",
    description: [
      "String Manager (i18n): the worker-safe REST surface — locale profiles, the",
      "insert-only key push, single-key overwrite, chunk publish, and the read-only",
      "key/draft listings.",
      "",
      "The fs/AST parts (scan, validate, install-loader, codemod) are NOT part of",
      "this API — they stay in the fs-having CLI/MCP.",
    ].join("\n"),
  },
  schemas: {},
  actions: [] as const,
  endpoints: [
    {
      operationId: "listI18nProfiles",
      method: "GET",
      path: "/profiles",
      summary: "List i18n profiles",
      description: "Returns every locale profile in the project (e.g. `en:prod`, `fr:prod`).",
      response: z.array(i18nProfileResponseSchema),
      examples: {
        response: [
          { id: "i18n_01j7w8a1b2c3", name: "en:prod", locales: ["en"], default_locale: "en" },
        ],
      },
      useCase: "Discover which locale profiles exist before pushing keys or publishing a chunk.",
    },
    {
      operationId: "createI18nProfile",
      method: "POST",
      path: "/profiles",
      summary: "Create an i18n profile",
      description: "Create a locale profile. `name` is the stable handle (e.g. `fr:prod`).",
      successStatus: 201,
      request: i18nProfileCreateSchema,
      response: i18nProfileCreateResponseSchema,
      examples: {
        request: { name: "fr:prod", locales: ["fr"], default_locale: "fr" },
        response: { id: "i18n_01j7w8a1b2c4", name: "fr:prod" },
      },
      useCase: "Stand up a new locale before seeding its keys.",
    },
    {
      operationId: "listI18nKeys",
      method: "GET",
      path: "/keys",
      summary: "List i18n keys",
      description: "List keys for a profile, optionally filtered to a name `prefix`.",
      queryParams: {
        profile_id: { schema: z.string().optional(), description: "Profile id to list keys for." },
        prefix: { schema: z.string().optional(), description: "Only keys whose name starts with this." },
        limit: {
          schema: z.coerce.number().int().min(1).max(500).optional(),
          description: "Max keys to return (1–500).",
        },
      },
      response: i18nKeyListResponseSchema,
      examples: {
        response: { keys: [{ id: "key_01j7", key: "checkout.cta", value: "Buy now" }] },
      },
      useCase: "Read the current keys (and values) for a profile — e.g. to diff before a push.",
    },
    {
      operationId: "pushI18nKeys",
      method: "POST",
      path: "/keys",
      summary: "Push new i18n keys (insert-only)",
      description:
        "Add NEW keys to a profile. Insert-only — existing keys are left untouched (overwrite one with `updateI18nKey`).",
      request: i18nPushKeysSchema,
      response: i18nPushResultSchema,
      examples: {
        request: {
          profile_id: "i18n_01j7w8a1b2c3",
          keys: [{ key: "checkout.cta", value: "Buy now" }],
        },
        response: { added: ["checkout.cta"], skipped: [], pushed_count: 1, skipped_count: 0 },
      },
      useCase: "Seed newly-extracted keys without clobbering translations already in the profile.",
    },
    {
      operationId: "updateI18nKey",
      method: "PUT",
      path: "/keys/{id}",
      summary: "Update one i18n key",
      description: "Overwrite a single existing key's value — the only overwrite path.",
      pathParams: { id: "The key's id." },
      request: i18nKeyUpdateSchema,
      response: i18nKeyUpdateResponseSchema,
      examples: {
        request: { value: "Buy it now" },
        response: { id: "key_01j7" },
      },
      useCase: "Correct or re-translate a single string in place.",
    },
    {
      operationId: "listI18nDrafts",
      method: "GET",
      path: "/drafts",
      summary: "List translation drafts",
      description: "List staged translation drafts awaiting review/publish.",
      response: z.array(i18nDraftResponseSchema),
      examples: { response: [{ id: "draft_01j7" }] },
      useCase: "Review machine-translation drafts before publishing them to a locale.",
    },
    {
      operationId: "publishI18nProfile",
      method: "POST",
      path: "/profiles/{profileId}/publish",
      summary: "Publish a profile chunk",
      description:
        "Publish a profile's chunk to the CDN (rebuild KV manifest + purge). Defaults to the `default` chunk.",
      pathParams: { profileId: "The profile id to publish." },
      request: i18nPublishSchema,
      response: i18nPublishResponseSchema,
      examples: {
        request: { chunk: "default" },
        response: { ok: true },
      },
      useCase: "Ship the latest translations live after pushing/updating keys.",
    },
  ] as const,
} as const;
