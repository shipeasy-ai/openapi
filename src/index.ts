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
  metricsClient,
  eventsClient,
  opsClient,
  projectsClient,
  i18nClient,
  attributesClient,
  RESOURCE_REGISTRY,
} from "./resources/index.js";
export type { AdminClient } from "./resources/index.js";

export type { Metric, MetricsClient, MetricCreateInput } from "./resources/metrics.js";
export type {
  CatalogEvent,
  EventsClient,
  EventProperty,
  EventCreateInput,
  EventUpdateInput,
} from "./resources/events.js";
export type {
  OpsClient,
  OpsItem,
  OpsType,
  OpsStatus,
  OpsPriority,
  OpsCreateInput,
  OpsUpdateInput,
  OpsNotifyInput,
  SlackChannel,
  SlackChannelsResponse,
} from "./resources/ops.js";
export type { ProjectsClient, UpsertResult, CurrentProject } from "./resources/projects.js";
export type {
  I18nClient,
  I18nProfile,
  I18nKey,
  I18nDraft,
  I18nPushResult,
} from "./resources/i18n.js";
export type { AttributesClient, Attribute } from "./resources/attributes.js";

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

// Operation registry — single source of truth that drives the CLI commands,
// the MCP tools, and their docs. See ./operations/index.ts.
export {
  ALL_OPERATIONS,
  RELEASE_OPERATIONS,
  gateOperations,
  killswitchOperations,
  configOperations,
  experimentOperations,
  universeOperations,
  metricOperations,
  METRIC_GRAMMAR,
  eventOperations,
  opsOperations,
  projectOperations,
  i18nOperations,
  attributeOperations,
  docsOperations,
  coerceInput,
  mountOperations,
  operationsToMcpTools,
  operationsToDispatch,
  renderOperationsMarkdown,
  opId,
  opCli,
  opMcpName,
} from "./operations/index.js";
export type {
  Operation,
  OpInput,
  OpExample,
  Param,
  ParamType,
  CommandLike,
  CliContext,
  McpTool,
} from "./operations/index.js";
