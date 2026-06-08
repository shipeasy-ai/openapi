// Pure enum constants shared by the admin-API contract schemas. Kept dependency-
// free (no zod, no drizzle) so both the Zod schemas here and core's Drizzle
// column definitions can import them as the single source of truth.

export const CONFIG_ENVS = ["dev", "staging", "prod"] as const;
export type ConfigEnv = (typeof CONFIG_ENVS)[number];

export const CONFIG_KINDS = ["config", "killswitch"] as const;
export type ConfigKind = (typeof CONFIG_KINDS)[number];
