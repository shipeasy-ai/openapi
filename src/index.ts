export { ApiError, createHttpTransport } from "./transport.js";
export type { Transport, HttpMethod, AuthSnapshot, HttpTransportOptions } from "./transport.js";

export {
  pageQuerySchema,
  encodeCursor,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "./pagination.js";
export type { Page, PageQuery, CursorParts } from "./pagination.js";

export {
  createAdminClient,
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
  RESOURCE_REGISTRY,
} from "./resources/index.js";
export type { AdminClient } from "./resources/index.js";

export type { Gate, GatesClient, GateCreateInput, GateUpdateInput } from "./resources/gates.js";
export type {
  Killswitch,
  KillswitchesClient,
  KillswitchCreateInput,
  KillswitchUpdateInput,
  KillswitchSwitchSetInput,
  KillswitchSwitchUnsetInput,
} from "./resources/killswitches.js";
export type {
  Experiment,
  ExperimentResult,
  ExperimentTimeseriesPoint,
  ExperimentStatus,
  ExperimentsClient,
  ExperimentCreateInput,
  ExperimentUpdateInput,
} from "./resources/experiments.js";
export type {
  Config,
  ConfigsClient,
  ConfigActivityEntry,
  ConfigCreateInput,
  ConfigUpdateInput,
  ConfigDraftUpsertInput,
  ConfigPublishInput,
} from "./resources/configs.js";
export type {
  Universe,
  UniversesClient,
  UniverseCreateInput,
  UniverseUpdateInput,
} from "./resources/universes.js";
export type {
  AlertRule,
  AlertRulesClient,
  AlertRuleCreateInput,
  AlertRuleUpdateInput,
} from "./resources/alert-rules.js";
