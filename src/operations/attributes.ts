import type { AdminClient } from "../resources/index.js";
import type { Operation } from "./types.js";

/**
 * Attribute operations — `attributes …`. One read-only op so the typed
 * `attributes_list` MCP tool replaces the `attributes` kind of the deleted
 * generic-read path (doc 21 §A4.3).
 */
export const attributeOperations: Operation[] = [
  {
    group: ["attributes"],
    name: "list",
    mutates: false,
    summary: "List targeting attributes",
    description:
      "List the auto-inferred user-attribute schema available for gate/experiment targeting.",
    params: [],
    examples: [{ run: "shipeasy attributes list" }],
    run: (client: AdminClient) => client.attributes.list(),
  },
];
