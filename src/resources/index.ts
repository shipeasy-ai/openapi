import type { Transport } from "../transport.js";
import { gatesClient, gatesResource } from "./gates.js";
import { experimentsClient, experimentsResource } from "./experiments.js";
import { configsClient, configsResource } from "./configs.js";
import { universesClient, universesResource } from "./universes.js";
import { killswitchesClient, killswitchesResource } from "./killswitches.js";
import { alertRulesClient } from "./alert-rules.js";
import { metricsClient } from "./metrics.js";
import { eventsClient } from "./events.js";
import { opsClient } from "./ops.js";
import { projectsClient } from "./projects.js";
import { i18nClient } from "./i18n.js";
import { attributesClient } from "./attributes.js";

/**
 * Aggregate admin client. Each resource lives in its own file under
 * ./resources/ — add a new entry here when you implement a new one.
 *
 * Both @shipeasy/cli and @shipeasy/mcp consume this client; do not duplicate
 * endpoint paths or request shapes in the consumer packages.
 */
export function createAdminClient(transport: Transport) {
  return {
    transport,
    gates: gatesClient(transport),
    experiments: experimentsClient(transport),
    configs: configsClient(transport),
    universes: universesClient(transport),
    killswitches: killswitchesClient(transport),
    alertRules: alertRulesClient(transport),
    metrics: metricsClient(transport),
    events: eventsClient(transport),
    ops: opsClient(transport),
    projects: projectsClient(transport),
    i18n: i18nClient(transport),
    attributes: attributesClient(transport),
  };
}

export type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Resource registry. MCP enumerates this to generate its tool catalog (one
 * tool per CRUD verb + one per action). CLI can iterate it to auto-wire
 * commander subcommands. Order is the surface order users see.
 */
export const RESOURCE_REGISTRY = [
  gatesResource,
  experimentsResource,
  configsResource,
  universesResource,
  killswitchesResource,
] as const;

export {
  gatesClient,
  gatesResource,
  experimentsClient,
  experimentsResource,
  configsClient,
  configsResource,
  universesClient,
  universesResource,
  killswitchesClient,
  killswitchesResource,
  alertRulesClient,
  metricsClient,
  eventsClient,
  opsClient,
  projectsClient,
  i18nClient,
  attributesClient,
};
