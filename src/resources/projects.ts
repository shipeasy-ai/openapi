import type { Transport } from "../transport.js";
import {
  projectUpsertSchema,
  projectUpsertResponseSchema,
  currentProjectResponseSchema,
  type UpsertResult,
  type CurrentProject,
} from "../schemas/projects.js";

/**
 * Projects — find-or-create by domain (`upsert`) and the auth-resolved current
 * project (`current`). The `.shipeasy` write that `bind`/`upsert --bind`
 * performs is a CONSUMER side-effect layered on top of these calls (it touches
 * the filesystem); it never lives in the resource, so this stays worker-safe.
 *
 * The wire shapes are now modeled in `../schemas/projects.ts`; `UpsertResult`
 * and `CurrentProject` are re-exported here as `z.infer` of those schemas so
 * the typed client and the OpenAPI descriptor share one source of truth.
 */
export type { UpsertResult, CurrentProject };

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

export const projectsResource = {
  name: "projects" as const,
  basePath: BASE,
  describeOne: "project",
  describeMany: "projects",
  tag: {
    name: "Projects",
    description: [
      "Projects: the account-level container every other resource is scoped to.",
      "",
      "**Account-level, not bound-project-level.** Both operations resolve from the caller's credential rather than the `.shipeasy`-bound project — `current` reads the project the auth header maps to, and `upsert` find-or-creates under the session's owner. Neither touches the local `.shipeasy` binding; recording the result there is a consumer side-effect layered on top.",
      "",
      "**Idempotent upsert.** A project is keyed by `(owner_email, domain)`. Calling `upsert` again with the same domain returns the existing project with `created: false`, so it is safe to run on every install.",
    ].join("\n"),
  },
  schemas: {
    upsert: projectUpsertSchema,
  },
  actions: [] as const,
  endpoints: [
    {
      operationId: "getCurrentProject",
      method: "GET",
      path: "/current",
      summary: "Show the current project",
      description:
        "Returns the project the caller's auth header resolves to — plan, status, billing, and which modules are enabled. The server reads the project from the credential, so there is no id parameter. Powers `whoami`.",
      response: currentProjectResponseSchema,
      examples: {
        response: {
          id: "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
          name: "Acme",
          domain: "acme.com",
          ownerEmail: "owner@acme.com",
          plan: "paid",
          status: "active",
          subscriptionStatus: "active",
          billingInterval: "monthly",
          currentPeriodEnd: "2026-07-12T00:00:00.000Z",
          trialEndsAt: null,
          cancelAtPeriodEnd: 0,
          moduleTranslations: true,
          moduleConfigs: true,
          moduleGates: true,
          moduleExperiments: true,
          moduleFeedback: true,
          createdAt: "2026-04-12T10:14:08.000Z",
          updatedAt: "2026-06-12T08:01:55.000Z",
        },
      },
      useCase:
        "Resolve who you are — the project, plan, and enabled modules tied to the current credential — without passing an id. Backs a registry-driven `whoami`.",
    },
    {
      operationId: "upsertProject",
      method: "POST",
      path: "/upsert",
      summary: "Find-or-create a project by domain",
      description: [
        "Find-or-creates a project keyed by `(owner_email, domain)` under the session's owner, and returns it. Idempotent: a second call with the same domain returns the existing project with `created: false`.",
        "",
        "Only `domain` is required — `name` defaults to the domain on first create. Recording the result in a local `.shipeasy` binding is a consumer side-effect; this endpoint never performs it.",
      ].join("\n"),
      request: projectUpsertSchema,
      response: projectUpsertResponseSchema,
      examples: {
        requestExamples: {
          minimal: {
            summary: "Minimal — domain only",
            description: "Smallest valid body. Names the project after the domain on first create.",
            value: { domain: "acme.com" },
          },
          named: {
            summary: "Named project",
            description: "Supply a human-readable `name` distinct from the domain.",
            value: { domain: "shouks.app", name: "Shouks" },
          },
        },
        response: {
          id: "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
          name: "Acme",
          domain: "acme.com",
          owner_email: "owner@acme.com",
          created: true,
        },
      },
      useCase: [
        "- **Install flow** — provision a per-app project without a trip to the dashboard. Run it on every install; the idempotent key means a re-run returns the existing project rather than duplicating it.",
        "- **Name explicitly** — pass `name` to label the project distinctly from its `domain`.",
      ].join("\n"),
    },
  ] as const,
} as const;
