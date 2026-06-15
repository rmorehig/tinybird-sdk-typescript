/**
 * Connection content generator
 * Converts ConnectionDefinition to native .connection file format
 */

import type {
  ConnectionDefinition,
  KafkaConnectionDefinition,
  GCSConnectionDefinition,
  DynamoDBConnectionDefinition,
} from "../schema/connection.js";
import {
  isS3ConnectionDefinition,
  isGCSConnectionDefinition,
  isDynamoDBConnectionDefinition,
  type S3ConnectionDefinition,
} from "../schema/connection.js";

/**
 * Generated connection content
 */
export interface GeneratedConnection {
  /** Connection name */
  name: string;
  /** The generated .connection file content */
  content: string;
}

/**
 * Generate a Kafka connection content
 */
function generateKafkaConnection(connection: KafkaConnectionDefinition): string {
  const parts: string[] = [];
  const options = connection.options;

  parts.push("TYPE kafka");
  parts.push(`KAFKA_BOOTSTRAP_SERVERS ${options.bootstrapServers}`);

  if (options.securityProtocol) {
    parts.push(`KAFKA_SECURITY_PROTOCOL ${options.securityProtocol}`);
  }

  if (options.saslMechanism) {
    parts.push(`KAFKA_SASL_MECHANISM ${options.saslMechanism}`);
  }

  if (options.saslOauthbearerMethod) {
    parts.push(`KAFKA_SASL_OAUTHBEARER_METHOD ${options.saslOauthbearerMethod}`);
  }

  if (options.saslOauthbearerAwsRegion) {
    parts.push(`KAFKA_SASL_OAUTHBEARER_AWS_REGION ${options.saslOauthbearerAwsRegion}`);
  }

  if (options.saslOauthbearerAwsRoleArn) {
    parts.push(`KAFKA_SASL_OAUTHBEARER_AWS_ROLE_ARN ${options.saslOauthbearerAwsRoleArn}`);
  }

  if (options.saslOauthbearerAwsExternalId) {
    parts.push(`KAFKA_SASL_OAUTHBEARER_AWS_EXTERNAL_ID ${options.saslOauthbearerAwsExternalId}`);
  }

  if (options.key) {
    parts.push(`KAFKA_KEY ${options.key}`);
  }

  if (options.secret) {
    parts.push(`KAFKA_SECRET ${options.secret}`);
  }

  if (options.schemaRegistryUrl) {
    parts.push(`KAFKA_SCHEMA_REGISTRY_URL ${options.schemaRegistryUrl}`);
  }

  if (options.sslCaPem) {
    if (options.sslCaPem.includes("\n")) {
      const indented = options.sslCaPem
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");
      parts.push(`KAFKA_SSL_CA_PEM >\n${indented}`);
    } else {
      parts.push(`KAFKA_SSL_CA_PEM ${options.sslCaPem}`);
    }
  }

  return parts.join("\n");
}

/**
 * Generate an S3 connection content
 */
function generateS3Connection(connection: S3ConnectionDefinition): string {
  const parts: string[] = [];
  const options = connection.options;

  parts.push("TYPE s3");
  parts.push(`S3_REGION ${options.region}`);

  if (options.arn) {
    parts.push(`S3_ARN ${options.arn}`);
  }

  if (options.accessKey) {
    parts.push(`S3_ACCESS_KEY ${options.accessKey}`);
  }

  if (options.secret) {
    parts.push(`S3_SECRET ${options.secret}`);
  }

  return parts.join("\n");
}

/**
 * Generate a GCS connection content
 */
function generateGCSConnection(connection: GCSConnectionDefinition): string {
  const parts: string[] = [];
  const options = connection.options;

  parts.push("TYPE gcs");
  parts.push(`GCS_SERVICE_ACCOUNT_CREDENTIALS_JSON ${options.serviceAccountCredentialsJson}`);

  return parts.join("\n");
}

/**
 * Generate a DynamoDB connection content
 */
function generateDynamoDBConnection(connection: DynamoDBConnectionDefinition): string {
  const parts: string[] = [];
  const options = connection.options;

  parts.push("TYPE dynamodb");
  parts.push(`DYNAMODB_ARN ${options.arn}`);
  parts.push(`DYNAMODB_REGION ${options.region}`);

  return parts.join("\n");
}

/**
 * Generate a .connection file content from a ConnectionDefinition
 *
 * @param connection - The connection definition
 * @returns Generated connection content
 *
 * @example
 * ```ts
 * const myKafka = defineKafkaConnection('my_kafka', {
 *   bootstrapServers: 'kafka.example.com:9092',
 *   securityProtocol: 'SASL_SSL',
 *   saslMechanism: 'PLAIN',
 *   key: '{{ tb_secret("KAFKA_KEY") }}',
 *   secret: '{{ tb_secret("KAFKA_SECRET") }}',
 * });
 *
 * const { content } = generateConnection(myKafka);
 * // Returns:
 * // TYPE kafka
 * // KAFKA_BOOTSTRAP_SERVERS kafka.example.com:9092
 * // KAFKA_SECURITY_PROTOCOL SASL_SSL
 * // KAFKA_SASL_MECHANISM PLAIN
 * // KAFKA_KEY {{ tb_secret("KAFKA_KEY") }}
 * // KAFKA_SECRET {{ tb_secret("KAFKA_SECRET") }}
 * ```
 */
export function generateConnection(
  connection: ConnectionDefinition
): GeneratedConnection {
  let content: string;

  if (connection._connectionType === "kafka") {
    content = generateKafkaConnection(connection as KafkaConnectionDefinition);
  } else if (isS3ConnectionDefinition(connection)) {
    content = generateS3Connection(connection);
  } else if (isGCSConnectionDefinition(connection)) {
    content = generateGCSConnection(connection);
  } else if (isDynamoDBConnectionDefinition(connection)) {
    content = generateDynamoDBConnection(connection);
  } else {
    throw new Error("Unsupported connection type.");
  }

  return {
    name: connection._name,
    content,
  };
}

/**
 * Generate .connection files for all connections in a project
 *
 * @param connections - Record of connection definitions
 * @returns Array of generated connection content
 */
export function generateAllConnections(
  connections: Record<string, ConnectionDefinition>
): GeneratedConnection[] {
  return Object.values(connections).map(generateConnection);
}
