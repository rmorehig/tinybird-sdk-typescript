/**
 * Connection definition for Tinybird
 * Define external connections (Kafka, S3, etc.) as TypeScript with full type safety
 */

// Symbol for brand typing - use Symbol.for() for global registry
// This ensures the same symbol is used across module instances
const CONNECTION_BRAND = Symbol.for("tinybird.connection");

/**
 * Kafka security protocol options
 */
export type KafkaSecurityProtocol = "SASL_SSL" | "PLAINTEXT" | "SASL_PLAINTEXT";

/**
 * Kafka SASL mechanism options
 */
export type KafkaSaslMechanism = "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512" | "OAUTHBEARER";

/**
 * Kafka SASL OAUTHBEARER provider method options
 */
export type KafkaSaslOauthbearerMethod = "AWS";

/**
 * Options for creating a Kafka connection
 */
export interface KafkaConnectionOptions {
  /** Kafka bootstrap servers (host:port) */
  bootstrapServers: string;
  /** Security protocol (default: 'SASL_SSL') */
  securityProtocol?: KafkaSecurityProtocol;
  /** SASL mechanism for authentication */
  saslMechanism?: KafkaSaslMechanism;
  /** SASL OAUTHBEARER provider method */
  saslOauthbearerMethod?: KafkaSaslOauthbearerMethod;
  /** AWS region for SASL OAUTHBEARER IAM authentication */
  saslOauthbearerAwsRegion?: string;
  /** AWS role ARN for SASL OAUTHBEARER IAM authentication */
  saslOauthbearerAwsRoleArn?: string;
  /** AWS external ID for SASL OAUTHBEARER IAM authentication */
  saslOauthbearerAwsExternalId?: string;
  /** Kafka key/username - can use {{ tb_secret(...) }} */
  key?: string;
  /** Kafka secret/password - can use {{ tb_secret(...) }} */
  secret?: string;
  /** Schema Registry URL (optionally with embedded auth credentials) */
  schemaRegistryUrl?: string;
  /** SSL CA certificate PEM - for private CA certs */
  sslCaPem?: string;
}

/**
 * Kafka-specific connection definition
 */
export interface KafkaConnectionDefinition {
  readonly [CONNECTION_BRAND]: true;
  /** Connection name */
  readonly _name: string;
  /** Type marker for inference */
  readonly _type: "connection";
  /** Connection type */
  readonly _connectionType: "kafka";
  /** Kafka options */
  readonly options: KafkaConnectionOptions;
}

/**
 * Options for defining an S3 connection
 */
export interface S3ConnectionOptions {
  /** S3 bucket region (for example: us-east-1) */
  region: string;
  /** IAM role ARN used by Tinybird to access the bucket */
  arn?: string;
  /** S3 access key for key/secret auth */
  accessKey?: string;
  /** S3 secret key for key/secret auth */
  secret?: string;
}

/**
 * S3-specific connection definition
 */
export interface S3ConnectionDefinition {
  readonly [CONNECTION_BRAND]: true;
  /** Connection name */
  readonly _name: string;
  /** Type marker for inference */
  readonly _type: "connection";
  /** Connection type */
  readonly _connectionType: "s3";
  /** S3 options */
  readonly options: S3ConnectionOptions;
}

/**
 * Options for defining a GCS connection
 */
export interface GCSConnectionOptions {
  /** Service account credentials JSON */
  serviceAccountCredentialsJson: string;
}

/**
 * GCS-specific connection definition
 */
export interface GCSConnectionDefinition {
  readonly [CONNECTION_BRAND]: true;
  /** Connection name */
  readonly _name: string;
  /** Type marker for inference */
  readonly _type: "connection";
  /** Connection type */
  readonly _connectionType: "gcs";
  /** GCS options */
  readonly options: GCSConnectionOptions;
}

/**
 * Options for defining a DynamoDB connection
 */
export interface DynamoDBConnectionOptions {
  /** DynamoDB table region (for example: us-east-1) */
  region: string;
  /** IAM role ARN used by Tinybird to access the table - can use {{ tb_secret(...) }} */
  arn: string;
}

/**
 * DynamoDB-specific connection definition
 */
export interface DynamoDBConnectionDefinition {
  readonly [CONNECTION_BRAND]: true;
  /** Connection name */
  readonly _name: string;
  /** Type marker for inference */
  readonly _type: "connection";
  /** Connection type */
  readonly _connectionType: "dynamodb";
  /** DynamoDB options */
  readonly options: DynamoDBConnectionOptions;
}

/**
 * A connection definition - union of all connection types
 */
export type ConnectionDefinition =
  | KafkaConnectionDefinition
  | S3ConnectionDefinition
  | GCSConnectionDefinition
  | DynamoDBConnectionDefinition;

function validateConnectionName(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid connection name: "${name}". Must start with a letter or underscore and contain only alphanumeric characters and underscores.`
    );
  }
}

/**
 * Define a Kafka connection
 *
 * @param name - The connection name (must be valid identifier)
 * @param options - Kafka connection configuration
 * @returns A connection definition that can be used in a project
 *
 * @example
 * ```ts
 * import { defineKafkaConnection } from '@tinybirdco/sdk';
 *
 * export const myKafka = defineKafkaConnection('my_kafka', {
 *   bootstrapServers: 'kafka.example.com:9092',
 *   securityProtocol: 'SASL_SSL',
 *   saslMechanism: 'PLAIN',
 *   key: '{{ tb_secret("KAFKA_KEY") }}',
 *   secret: '{{ tb_secret("KAFKA_SECRET") }}',
 * });
 * ```
 */
export function defineKafkaConnection(
  name: string,
  options: KafkaConnectionOptions
): KafkaConnectionDefinition {
  validateConnectionName(name);

  return {
    [CONNECTION_BRAND]: true,
    _name: name,
    _type: "connection",
    _connectionType: "kafka",
    options,
  };
}

/**
 * @deprecated Use defineKafkaConnection instead.
 */
export const createKafkaConnection = defineKafkaConnection;

/**
 * Define an S3 connection
 *
 * @param name - The connection name (must be valid identifier)
 * @param options - S3 connection configuration
 * @returns A connection definition that can be used in a project
 */
export function defineS3Connection(
  name: string,
  options: S3ConnectionOptions
): S3ConnectionDefinition {
  validateConnectionName(name);

  if (!options.arn && !(options.accessKey && options.secret)) {
    throw new Error(
      "S3 connection requires either `arn` or both `accessKey` and `secret`."
    );
  }

  if ((options.accessKey && !options.secret) || (!options.accessKey && options.secret)) {
    throw new Error("S3 connection `accessKey` and `secret` must be provided together.");
  }

  return {
    [CONNECTION_BRAND]: true,
    _name: name,
    _type: "connection",
    _connectionType: "s3",
    options,
  };
}

/**
 * Define a GCS connection
 *
 * @param name - The connection name (must be valid identifier)
 * @param options - GCS connection configuration
 * @returns A connection definition that can be used in a project
 */
export function defineGCSConnection(
  name: string,
  options: GCSConnectionOptions
): GCSConnectionDefinition {
  validateConnectionName(name);

  if (!options.serviceAccountCredentialsJson.trim()) {
    throw new Error("GCS connection `serviceAccountCredentialsJson` is required.");
  }

  return {
    [CONNECTION_BRAND]: true,
    _name: name,
    _type: "connection",
    _connectionType: "gcs",
    options,
  };
}

/**
 * Define a DynamoDB connection
 *
 * @param name - The connection name (must be valid identifier)
 * @param options - DynamoDB connection configuration
 * @returns A connection definition that can be used in a project
 *
 * @example
 * ```ts
 * import { defineDynamoDBConnection } from '@tinybirdco/sdk';
 *
 * export const myDynamo = defineDynamoDBConnection('my_dynamo', {
 *   region: 'us-east-1',
 *   arn: '{{ tb_secret("DYNAMODB_ROLE_ARN") }}',
 * });
 * ```
 */
export function defineDynamoDBConnection(
  name: string,
  options: DynamoDBConnectionOptions
): DynamoDBConnectionDefinition {
  validateConnectionName(name);

  if (!options.region?.trim()) {
    throw new Error("DynamoDB connection `region` is required.");
  }

  if (!options.arn?.trim()) {
    throw new Error("DynamoDB connection `arn` is required.");
  }

  return {
    [CONNECTION_BRAND]: true,
    _name: name,
    _type: "connection",
    _connectionType: "dynamodb",
    options,
  };
}

/**
 * Check if a value is a connection definition
 */
export function isConnectionDefinition(value: unknown): value is ConnectionDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    CONNECTION_BRAND in value &&
    (value as Record<symbol, unknown>)[CONNECTION_BRAND] === true
  );
}

/**
 * Check if a value is a Kafka connection definition
 */
export function isKafkaConnectionDefinition(value: unknown): value is KafkaConnectionDefinition {
  return isConnectionDefinition(value) && value._connectionType === "kafka";
}

/**
 * Check if a value is an S3 connection definition
 */
export function isS3ConnectionDefinition(value: unknown): value is S3ConnectionDefinition {
  return isConnectionDefinition(value) && value._connectionType === "s3";
}

/**
 * Check if a value is a GCS connection definition
 */
export function isGCSConnectionDefinition(value: unknown): value is GCSConnectionDefinition {
  return isConnectionDefinition(value) && value._connectionType === "gcs";
}

/**
 * Check if a value is a DynamoDB connection definition
 */
export function isDynamoDBConnectionDefinition(
  value: unknown
): value is DynamoDBConnectionDefinition {
  return isConnectionDefinition(value) && value._connectionType === "dynamodb";
}

/**
 * Get the connection type from a connection definition
 */
export function getConnectionType<T extends ConnectionDefinition>(
  connection: T
): T["_connectionType"] {
  return connection._connectionType;
}
