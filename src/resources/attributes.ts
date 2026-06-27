import type { Transport } from "../transport.js";

/**
 * Targeting attributes — the auto-inferred user-attribute schema the dashboard
 * surfaces for gate/experiment targeting. Read-only; this exists so the typed
 * `attributes list` op can replace the `attributes` kind of the old MCP-only
 * "generic read" (`list_resources`), which is being deleted (see doc 21 §A4.3).
 */
export interface Attribute {
  name: string;
  type?: string;
  [key: string]: unknown;
}

export interface AttributesClient {
  list(): Promise<Attribute[]>;
}

const BASE = "/api/admin/attributes";

export function attributesClient(t: Transport): AttributesClient {
  return {
    list: () => t.request<Attribute[]>("GET", BASE),
  };
}
