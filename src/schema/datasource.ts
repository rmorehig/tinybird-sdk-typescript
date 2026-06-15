/**
 * Datasource definition for Tinybird
 * Define table schemas as TypeScript with full type safety
 */

import { getModifiers, isTypeValidator, type AnyTypeValidator } from "./types.js";
import type { EngineConfig } from "./engines.js";
import type {
  KafkaConnectionDefinition,
  S3ConnectionDefinition,
  GCSConnectionDefinition,
  DynamoDBConnectionDefinition,
} from "./connection.js";
import type { TokenDefinition, DatasourceTokenScope } from "./token.js";

// Symbol for brand typing - use Symbol.for() for global registry
// This ensures the same symbol is used across module instances
const DATASOURCE_BRAND = Symbol.for("tinybird.datasource");

/**
 * A column can be defined as just a type validator,
 * or with additional options like JSON path or default value
 */
export interface ColumnDefinition<T extends AnyTypeValidator = AnyTypeValidator> {
  /** The column type */
  type: T;
  /** JSON path for extracting from nested JSON (e.g., '$.user.id') */
  jsonPath?: string;
}

/**
 * Schema definition is a record of column names to type validators or column definitions
 */
export type SchemaDefinition = Record<string, AnyTypeValidator | ColumnDefinition>;

/**
 * Inline token configuration for datasource access
 */
export interface InlineTokenConfig {
  /** Token name */
  name: string;
  /** Permissions granted to this token */
  permissions: readonly DatasourceTokenScope[];
}

/**
 * Token reference with datasource-specific scope
 */
export interface DatasourceTokenReference {
  /** The token definition */
  token: TokenDefinition;
  /** Scope for this datasource (READ or APPEND) */
  scope: DatasourceTokenScope;
}

/**
 * Token configuration for datasource access.
 * Can be either an inline definition or a reference to a defined token.
 */
export type TokenConfig = InlineTokenConfig | DatasourceTokenReference;

/**
 * Kafka ingestion configuration for a datasource
 */
export interface KafkaConfig {
  /** Kafka connection to use */
  connection: KafkaConnectionDefinition;
  /** Kafka topic to consume from */
  topic: string;
  /** Consumer group ID (optional) */
  groupId?: string;
  /** Where to start reading: 'earliest' or 'latest' (default: 'latest') */
  autoOffsetReset?: "earliest" | "latest";
  /** Whether to store the raw Kafka value payload */
  storeRawValue?: boolean;
}

/**
 * S3 import configuration for a datasource
 */
export interface S3Config {
  /** S3 connection to use */
  connection: S3ConnectionDefinition;
  /** S3 bucket URI, for example: s3://my-bucket/path/*.csv */
  bucketUri: string;
  /** Import schedule, for example: @auto or @once */
  schedule?: string;
  /** Incremental import lower bound timestamp expression */
  fromTimestamp?: string;
}

/**
 * GCS import configuration for a datasource
 */
export interface GCSConfig {
  /** GCS connection to use */
  connection: GCSConnectionDefinition;
  /** GCS bucket URI, for example: gs://my-bucket/path/*.csv */
  bucketUri: string;
  /** Import schedule, for example: @auto or @once */
  schedule?: string;
  /** Incremental import lower bound timestamp expression */
  fromTimestamp?: string;
}

/**
 * DynamoDB import configuration for a datasource
 */
export interface DynamoDBConfig {
  /** DynamoDB connection to use */
  connection: DynamoDBConnectionDefinition;
  /** Source DynamoDB table ARN */
  tableArn: string;
  /** S3 bucket Tinybird uses to stage the initial table export */
  exportBucket: string;
}

/**
 * Datasource index configuration.
 * Emits as: `<name> <expr> TYPE <type> GRANULARITY <n>`
 */
export interface DatasourceIndex {
  /** Index name */
  name: string;
  /** Index expression */
  expr: string;
  /** Index type and parameters (for example: `set(100)`) */
  type: string;
  /** Index granularity */
  granularity: number;
}

/**
 * Options for defining a datasource
 */
export interface DatasourceOptions<TSchema extends SchemaDefinition> {
  /** Human-readable description of the datasource */
  description?: string;
  /** Column schema definition */
  schema: TSchema;
  /** Table engine configuration */
  engine?: EngineConfig;
  /** Access tokens for this datasource */
  tokens?: readonly TokenConfig[];
  /** Workspaces to share this datasource with */
  sharedWith?: readonly string[];
  /**
   * Whether to generate JSON path expressions for columns.
   * Set to false for datasources that are targets of materialized views.
   * Defaults to true.
   */
  jsonPaths?: boolean;
  /**
   * Forward query used to evolve a datasource with incompatible schema changes.
   * This should be the SELECT clause only (no FROM/WHERE).
   */
  forwardQuery?: string;
  /** Secondary indexes for MergeTree-family engines */
  indexes?: readonly DatasourceIndex[];
  /** Skip backfilling data when creating a datasource targeted by a materialized view */
  backfill?: "skip";
  /** Kafka ingestion configuration */
  kafka?: KafkaConfig;
  /** S3 ingestion configuration */
  s3?: S3Config;
  /** GCS ingestion configuration */
  gcs?: GCSConfig;
  /** DynamoDB ingestion configuration */
  dynamodb?: DynamoDBConfig;
}

/**
 * A datasource definition with full type information
 */
export interface DatasourceDefinition<TSchema extends SchemaDefinition = SchemaDefinition> {
  readonly [DATASOURCE_BRAND]: true;
  /** Datasource name */
  readonly _name: string;
  /** Type marker for inference */
  readonly _type: "datasource";
  /** Schema definition */
  readonly _schema: TSchema;
  /** Full options */
  readonly options: DatasourceOptions<TSchema>;
}

/**
 * Define a Tinybird datasource
 *
 * @param name - The datasource name (must be valid identifier)
 * @param options - Datasource configuration including schema and engine
 * @returns A datasource definition that can be used in a project
 *
 * @example
 * ```ts
 * import { defineDatasource, t, engine } from '@tinybirdco/sdk';
 *
 * export const events = defineDatasource('events', {
 *   description: 'User event tracking data',
 *   schema: {
 *     timestamp: t.dateTime(),
 *     event_id: t.uuid(),
 *     user_id: t.string(),
 *     event_type: t.string().lowCardinality(),
 *     properties: t.json(),
 *     session_id: t.string().nullable(),
 *   },
 *   engine: engine.mergeTree({
 *     sortingKey: ['user_id', 'timestamp'],
 *     partitionKey: 'toYYYYMM(timestamp)',
 *     ttl: 'timestamp + INTERVAL 90 DAY',
 *   }),
 * });
 * ```
 */
export function defineDatasource<TSchema extends SchemaDefinition>(
  name: string,
  options: DatasourceOptions<TSchema>
): DatasourceDefinition<TSchema> {
  // Validate name is a valid identifier
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid datasource name: "${name}". Must start with a letter or underscore and contain only alphanumeric characters and underscores.`
    );
  }

  const ingestionConfigCount = [options.kafka, options.s3, options.gcs, options.dynamodb].filter(
    Boolean
  ).length;
  if (ingestionConfigCount > 1) {
    throw new Error(
      "Datasource can only define one ingestion option: `kafka`, `s3`, `gcs`, or `dynamodb`."
    );
  }

  if (options.indexes) {
    for (const index of options.indexes) {
      if (!index.name || /\s/.test(index.name)) {
        throw new Error(
          `Invalid datasource index name: "${index.name}". Index names must be non-empty and cannot contain whitespace.`
        );
      }
      if (!index.expr?.trim()) {
        throw new Error(`Invalid datasource index "${index.name}": expr is required.`);
      }
      if (!index.type?.trim()) {
        throw new Error(`Invalid datasource index "${index.name}": type is required.`);
      }
      if (!Number.isInteger(index.granularity) || index.granularity <= 0) {
        throw new Error(
          `Invalid datasource index "${index.name}": granularity must be a positive integer.`
        );
      }
    }
  }

  return {
    [DATASOURCE_BRAND]: true,
    _name: name,
    _type: "datasource",
    _schema: options.schema,
    options,
  };
}

/**
 * Check if a value is a datasource definition
 */
export function isDatasourceDefinition(value: unknown): value is DatasourceDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    DATASOURCE_BRAND in value &&
    (value as Record<symbol, unknown>)[DATASOURCE_BRAND] === true
  );
}

/**
 * Get the column type for a schema entry (handles both raw validators and column definitions)
 */
export function getColumnType(column: AnyTypeValidator | ColumnDefinition): AnyTypeValidator {
  if ("type" in column && typeof column.type === "object") {
    return column.type;
  }
  return column as AnyTypeValidator;
}

/**
 * Get the JSON path for a column if defined
 */
export function getColumnJsonPath(column: AnyTypeValidator | ColumnDefinition): string | undefined {
  if (isTypeValidator(column)) {
    return getModifiers(column).jsonPath;
  }

  // Check typeof to avoid returning the jsonPath method from validators
  // if isTypeValidator incorrectly returns false (e.g., cross-module Symbol issues)
  if (typeof column.jsonPath === "string") {
    return column.jsonPath;
  }

  if (isTypeValidator(column.type)) {
    return getModifiers(column.type).jsonPath;
  }

  return undefined;
}

/**
 * Get all column names from a schema
 */
export function getColumnNames<TSchema extends SchemaDefinition>(
  schema: TSchema
): (keyof TSchema)[] {
  return Object.keys(schema) as (keyof TSchema)[];
}

/**
 * Helper type to extract the schema from a datasource definition
 */
export type ExtractSchema<T> = T extends DatasourceDefinition<infer S> ? S : never;

/**
 * Column definition helper for complex column configurations
 *
 * @example
 * ```ts
 * import { defineDatasource, t, column } from '@tinybirdco/sdk';
 *
 * export const events = defineDatasource('events', {
 *   schema: {
 *     // Simple column
 *     id: t.string(),
 *     // Column with JSON extraction
 *     user_id: column(t.string(), { jsonPath: '$.user.id' }),
 *   },
 * });
 * ```
 */
export function column<T extends AnyTypeValidator>(
  type: T,
  options?: Omit<ColumnDefinition<T>, "type">
): ColumnDefinition<T> {
  return {
    type,
    ...options,
  };
}
