import type { Transport } from "../transport.js";
import { ApiError } from "../transport.js";

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
