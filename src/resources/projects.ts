import type { Transport } from "../transport.js";

/**
 * Projects — find-or-create by domain (`upsert`) and the auth-resolved current
 * project (`current`). The `.shipeasy` write that `bind`/`upsert --bind`
 * performs is a CONSUMER side-effect layered on top of these calls (it touches
 * the filesystem); it never lives in the resource, so this stays worker-safe.
 */
export interface UpsertResult {
  id: string;
  name: string;
  domain: string | null;
  owner_email: string;
  created: boolean;
}

/**
 * The project the caller's auth header resolves to. The server reads the
 * project from the credential — there is no id parameter — so `current` works
 * with nothing but the session, which is what makes a registry-driven `whoami`
 * possible.
 */
export interface CurrentProject {
  id: string;
  name: string;
  domain: string | null;
  ownerEmail: string;
  plan: "free" | "paid";
  status: "active" | "inactive";
  subscriptionStatus: string;
  billingInterval: "monthly" | "annual";
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: number;
  moduleTranslations: boolean | number;
  moduleConfigs: boolean | number;
  moduleGates: boolean | number;
  moduleExperiments: boolean | number;
  moduleFeedback: boolean | number;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ProjectsClient {
  /** Find-or-create a project by domain (idempotent). */
  upsert(input: { domain: string; name?: string }): Promise<UpsertResult>;
  /** The project the auth header resolves to (no id needed). */
  current(): Promise<CurrentProject>;
}

const BASE = "/api/admin/projects";

export function projectsClient(t: Transport): ProjectsClient {
  return {
    upsert: (input) =>
      t.request<UpsertResult>("POST", `${BASE}/upsert`, {
        domain: input.domain,
        ...(input.name ? { name: input.name } : {}),
      }),
    current: () => t.request<CurrentProject>("GET", `${BASE}/current`),
  };
}
