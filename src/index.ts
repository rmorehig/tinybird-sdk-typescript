/**
 * @tinybirdco/sdk - TypeScript SDK for Tinybird Forward
 *
 * Define datasources and pipes as TypeScript with full type safety.
 *
 * @example
 * ```ts
 * import {
 *   defineDatasource,
 *   definePipe,
 *   defineProject,
 *   node,
 *   t,
 *   p,
 *   engine,
 *   createClient,
 * } from '@tinybirdco/sdk';
 *
 * // Define a datasource
 * const events = defineDatasource('events', {
 *   schema: {
 *     timestamp: t.dateTime(),
 *     user_id: t.string(),
 *     event_type: t.string().lowCardinality(),
 *   },
 *   engine: engine.mergeTree({
 *     sortingKey: ['user_id', 'timestamp'],
 *   }),
 * });
 *
 * // Define a pipe
 * const topEvents = definePipe('top_events', {
 *   params: {
 *     limit: p.int32().optional(10),
 *   },
 *   nodes: [
 *     node({
 *       name: 'aggregated',
 *       sql: 'SELECT event_type, count() as cnt FROM events GROUP BY event_type LIMIT {{Int32(limit, 10)}}',
 *     }),
 *   ],
 *   output: {
 *     event_type: t.string(),
 *     cnt: t.uint64(),
 *   },
 *   endpoint: true,
 * });
 *
 * // Create project
 * export default defineProject({
 *   datasources: { events },
 *   pipes: { topEvents },
 * });
 * ```
 */

// ============ Schema Types ============
export { t } from "./schema/types.js";
export type {
  TypeValidator,
  AnyTypeValidator,
  TypeModifiers,
  InferType,
  TinybirdType,
} from "./schema/types.js";
export {
  isTypeValidator,
  getTinybirdType,
  getModifiers,
} from "./schema/types.js";

// ============ Parameter Types ============
export { p } from "./schema/params.js";
export type {
  ParamValidator,
  AnyParamValidator,
  InferParamType,
} from "./schema/params.js";
export {
  isParamValidator,
  getParamTinybirdType,
  isParamRequired,
  getParamDefault,
  getParamDescription,
} from "./schema/params.js";

// ============ Engine Configurations ============
export { engine, getEngineClause, getSortingKey, getPrimaryKey } from "./schema/engines.js";
export type {
  EngineConfig,
  MergeTreeEngineConfig,
  BaseMergeTreeConfig,
  MergeTreeConfig,
  ReplacingMergeTreeConfig,
  SummingMergeTreeConfig,
  AggregatingMergeTreeConfig,
  CollapsingMergeTreeConfig,
  VersionedCollapsingMergeTreeConfig,
  NullEngineConfig,
} from "./schema/engines.js";

// ============ Utilities ============
export { secret } from "./schema/secret.js";

// ============ Datasource ============
export { defineDatasource, isDatasourceDefinition, column, getColumnType, getColumnJsonPath, getColumnNames } from "./schema/datasource.js";
export type {
  DatasourceDefinition,
  DatasourceOptions,
  SchemaDefinition,
  ColumnDefinition,
  TokenConfig,
  InlineTokenConfig,
  DatasourceTokenReference,
  ExtractSchema,
  KafkaConfig,
  S3Config,
  GCSConfig,
  DynamoDBConfig,
  DatasourceIndex,
} from "./schema/datasource.js";

// ============ Connection ============
export {
  defineKafkaConnection,
  createKafkaConnection,
  defineS3Connection,
  defineGCSConnection,
  defineDynamoDBConnection,
  isConnectionDefinition,
  isKafkaConnectionDefinition,
  isS3ConnectionDefinition,
  isGCSConnectionDefinition,
  isDynamoDBConnectionDefinition,
  getConnectionType,
} from "./schema/connection.js";
export type {
  ConnectionDefinition,
  KafkaConnectionDefinition,
  KafkaConnectionOptions,
  KafkaSecurityProtocol,
  KafkaSaslMechanism,
  KafkaSaslOauthbearerMethod,
  S3ConnectionDefinition,
  S3ConnectionOptions,
  GCSConnectionDefinition,
  GCSConnectionOptions,
  DynamoDBConnectionDefinition,
  DynamoDBConnectionOptions,
} from "./schema/connection.js";

// ============ Token ============
export { defineToken, isTokenDefinition } from "./schema/token.js";
export type {
  TokenDefinition,
  DatasourceTokenScope,
  PipeTokenScope,
} from "./schema/token.js";

// ============ Pipe ============
export {
  definePipe,
  defineEndpoint,
  defineMaterializedView,
  defineCopyPipe,
  defineSinkPipe,
  node,
  isPipeDefinition,
  isNodeDefinition,
  getEndpointConfig,
  getMaterializedConfig,
  getCopyConfig,
  getSinkConfig,
  isMaterializedView,
  isCopyPipe,
  isSinkPipe,
  getNodeNames,
  getNode,
  sql,
} from "./schema/pipe.js";
export type {
  PipeDefinition,
  PipeOptions,
  EndpointOptions,
  CopyPipeOptions,
  SinkPipeOptions,
  CopyConfig,
  SinkConfig,
  SinkStrategy,
  SinkCompression,
  KafkaSinkConfig,
  S3SinkConfig,
  NodeDefinition,
  NodeOptions,
  ParamsDefinition,
  OutputDefinition,
  EndpointConfig,
  MaterializedConfig,
  MaterializedViewOptions,
  PipeTokenConfig,
  InlinePipeTokenConfig,
  PipeTokenReference,
  ExtractParams,
  ExtractOutput,
} from "./schema/pipe.js";

// ============ Project ============
export {
  defineProject,
  isProjectDefinition,
  getDatasourceNames,
  getPipeNames,
  getDatasource,
  getPipe,
  Tinybird,
} from "./schema/project.js";
export type {
  ProjectDefinition,
  ProjectConfig,
  DatasourcesDefinition,
  PipesDefinition,
  ConnectionsDefinition,
  ExtractDatasources,
  ExtractPipes,
  DataModel,
} from "./schema/project.js";

// ============ Type Inference ============
export type {
  Infer,
  InferRow,
  InferParams,
  InferOutput,
  InferOutputRow,
  InferEvent,
  PartialRow,
  InferSchema,
  InferTinybirdTypes,
  InferMaterializedTarget,
  InferMaterializedTargetRow,
  IsMaterializedPipe,
} from "./infer/index.js";

// ============ Client ============
export { TinybirdClient, createClient } from "./client/base.js";
export { TinybirdError } from "./client/types.js";
export type {
  AppendOptions,
  AppendResult,
  ClientConfig,
  ClientContext,
  CsvDialectOptions,
  DatasourcesNamespace,
  DeleteOptions,
  DeleteResult,
  QueryResult,
  IngestResult,
  QueryOptions,
  IngestOptions,
  TruncateOptions,
  TruncateResult,
  ColumnMeta,
  QueryStatistics,
  TinybirdErrorResponse,
  TypedPipeEndpoint,
  TypedDatasourceIngest,
} from "./client/types.js";

// ============ Public Tinybird API ============
export {
  TinybirdApi,
  TinybirdApiError,
  createTinybirdApi,
  createTinybirdApiWrapper,
} from "./api/api.js";
export type {
  TinybirdApiConfig,
  TinybirdApiQueryOptions,
  TinybirdApiIngestOptions,
  TinybirdApiAppendOptions,
  TinybirdApiDeleteOptions,
  TinybirdApiTruncateOptions,
  TinybirdApiRequestInit,
  TinybirdApiTokenScope,
  TinybirdApiCreateTokenRequest,
  TinybirdApiCreateTokenOptions,
  TinybirdApiCreateTokenResult,
} from "./api/api.js";

// ============ Preview Environment ============
export {
  isPreviewEnvironment,
  getPreviewBranchName,
  resolveToken,
  clearTokenCache,
} from "./client/preview.js";

// ============ Dashboard URL Utilities ============
export {
  parseApiUrl,
  getDashboardUrl,
  getBranchDashboardUrl,
  getLocalDashboardUrl,
} from "./api/dashboard.js";
export type { RegionInfo } from "./api/dashboard.js";

// ============ Token API ============
export { createJWT, TokenApiError } from "./api/tokens.js";
export type {
  TokenApiConfig,
  JWTScope,
  JWTScopeType,
  JWTLimits,
  CreateJWTOptions,
  CreateJWTResult,
} from "./api/tokens.js";

// ============ Config Types ============
// Import from config-types.ts to avoid bundling esbuild in client code
export type { TinybirdConfig, DevMode } from "./cli/config-types.js";
