import type {
  DynamoDBConnectionModel,
  GCSConnectionModel,
  KafkaConnectionModel,
  ResourceFile,
  S3ConnectionModel,
} from "./types.js";
import {
  MigrationParseError,
  isBlank,
  parseDirectiveLine,
  parseQuotedValue,
  readDirectiveBlock,
  splitLines,
} from "./parser-utils.js";

const CONNECTION_DIRECTIVES = new Set([
  "TYPE",
  "KAFKA_BOOTSTRAP_SERVERS",
  "KAFKA_SECURITY_PROTOCOL",
  "KAFKA_SASL_MECHANISM",
  "KAFKA_SASL_OAUTHBEARER_METHOD",
  "KAFKA_SASL_OAUTHBEARER_AWS_REGION",
  "KAFKA_SASL_OAUTHBEARER_AWS_ROLE_ARN",
  "KAFKA_SASL_OAUTHBEARER_AWS_EXTERNAL_ID",
  "KAFKA_KEY",
  "KAFKA_SECRET",
  "KAFKA_SCHEMA_REGISTRY_URL",
  "KAFKA_SSL_CA_PEM",
  "S3_REGION",
  "S3_ARN",
  "S3_ACCESS_KEY",
  "S3_SECRET",
  "GCS_SERVICE_ACCOUNT_CREDENTIALS_JSON",
  "DYNAMODB_ARN",
  "DYNAMODB_REGION",
]);

function isConnectionDirectiveLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return false;
  const firstSpace = trimmed.indexOf(" ");
  const word = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  return CONNECTION_DIRECTIVES.has(word);
}

export function parseConnectionFile(
  resource: ResourceFile
): KafkaConnectionModel | S3ConnectionModel | GCSConnectionModel | DynamoDBConnectionModel {
  const lines = splitLines(resource.content);
  let connectionType: string | undefined;

  let bootstrapServers: string | undefined;
  let securityProtocol:
    | "SASL_SSL"
    | "PLAINTEXT"
    | "SASL_PLAINTEXT"
    | undefined;
  let saslMechanism:
    | "PLAIN"
    | "SCRAM-SHA-256"
    | "SCRAM-SHA-512"
    | "OAUTHBEARER"
    | undefined;
  let saslOauthbearerMethod: "AWS" | undefined;
  let saslOauthbearerAwsRegion: string | undefined;
  let saslOauthbearerAwsRoleArn: string | undefined;
  let saslOauthbearerAwsExternalId: string | undefined;
  let key: string | undefined;
  let secret: string | undefined;
  let schemaRegistryUrl: string | undefined;
  let sslCaPem: string | undefined;

  let region: string | undefined;
  let arn: string | undefined;
  let accessKey: string | undefined;
  let accessSecret: string | undefined;
  let serviceAccountCredentialsJson: string | undefined;

  let dynamodbArn: string | undefined;
  let dynamodbRegion: string | undefined;

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i] ?? "";
    const line = rawLine.trim();
    if (isBlank(line) || line.startsWith("#")) {
      i += 1;
      continue;
    }

    const { key: directive, value } = parseDirectiveLine(line);
    switch (directive) {
      case "TYPE":
        connectionType = parseQuotedValue(value);
        break;
      case "KAFKA_BOOTSTRAP_SERVERS":
        bootstrapServers = value;
        break;
      case "KAFKA_SECURITY_PROTOCOL":
        if (value !== "SASL_SSL" && value !== "PLAINTEXT" && value !== "SASL_PLAINTEXT") {
          throw new MigrationParseError(
            resource.filePath,
            "connection",
            resource.name,
            `Unsupported KAFKA_SECURITY_PROTOCOL: "${value}"`
          );
        }
        securityProtocol = value;
        break;
      case "KAFKA_SASL_MECHANISM":
        if (
          value !== "PLAIN" &&
          value !== "SCRAM-SHA-256" &&
          value !== "SCRAM-SHA-512" &&
          value !== "OAUTHBEARER"
        ) {
          throw new MigrationParseError(
            resource.filePath,
            "connection",
            resource.name,
            `Unsupported KAFKA_SASL_MECHANISM: "${value}"`
          );
        }
        saslMechanism = value;
        break;
      case "KAFKA_SASL_OAUTHBEARER_METHOD":
        if (value !== "AWS") {
          throw new MigrationParseError(
            resource.filePath,
            "connection",
            resource.name,
            `Unsupported KAFKA_SASL_OAUTHBEARER_METHOD: "${value}"`
          );
        }
        saslOauthbearerMethod = value;
        break;
      case "KAFKA_SASL_OAUTHBEARER_AWS_REGION":
        saslOauthbearerAwsRegion = value;
        break;
      case "KAFKA_SASL_OAUTHBEARER_AWS_ROLE_ARN":
        saslOauthbearerAwsRoleArn = value;
        break;
      case "KAFKA_SASL_OAUTHBEARER_AWS_EXTERNAL_ID":
        saslOauthbearerAwsExternalId = value;
        break;
      case "KAFKA_KEY":
        key = value;
        break;
      case "KAFKA_SECRET":
        secret = value;
        break;
      case "KAFKA_SCHEMA_REGISTRY_URL":
        schemaRegistryUrl = value;
        break;
      case "KAFKA_SSL_CA_PEM":
        if (value === ">") {
          const block = readDirectiveBlock(lines, i + 1, isConnectionDirectiveLine);
          sslCaPem = block.lines.join("\n");
          i = block.nextIndex;
          continue;
        }
        sslCaPem = value;
        break;
      case "S3_REGION":
        region = parseQuotedValue(value);
        break;
      case "S3_ARN":
        arn = parseQuotedValue(value);
        break;
      case "S3_ACCESS_KEY":
        accessKey = parseQuotedValue(value);
        break;
      case "S3_SECRET":
        accessSecret = parseQuotedValue(value);
        break;
      case "GCS_SERVICE_ACCOUNT_CREDENTIALS_JSON":
        if (value === ">") {
          const block = readDirectiveBlock(lines, i + 1, isConnectionDirectiveLine);
          serviceAccountCredentialsJson = block.lines.join("\n");
          i = block.nextIndex;
          continue;
        }
        serviceAccountCredentialsJson = parseQuotedValue(value);
        break;
      case "DYNAMODB_ARN":
        dynamodbArn = parseQuotedValue(value);
        break;
      case "DYNAMODB_REGION":
        dynamodbRegion = parseQuotedValue(value);
        break;
      default:
        throw new MigrationParseError(
          resource.filePath,
          "connection",
          resource.name,
          `Unsupported connection directive in strict mode: "${line}"`
        );
    }
    i += 1;
  }

  if (!connectionType) {
    throw new MigrationParseError(
      resource.filePath,
      "connection",
      resource.name,
      "TYPE directive is required."
    );
  }

  if (connectionType === "kafka") {
    if (
      region ||
      arn ||
      accessKey ||
      accessSecret ||
      serviceAccountCredentialsJson ||
      dynamodbArn ||
      dynamodbRegion
    ) {
      throw new MigrationParseError(
        resource.filePath,
        "connection",
        resource.name,
        "S3/GCS/DynamoDB directives are not valid for kafka connections."
      );
    }

    if (!bootstrapServers) {
      throw new MigrationParseError(
        resource.filePath,
        "connection",
        resource.name,
        "KAFKA_BOOTSTRAP_SERVERS is required for kafka connections."
      );
    }

    return {
      kind: "connection",
      name: resource.name,
      filePath: resource.filePath,
      connectionType: "kafka",
      bootstrapServers,
      securityProtocol,
      saslMechanism,
      saslOauthbearerMethod,
      saslOauthbearerAwsRegion,
      saslOauthbearerAwsRoleArn,
      saslOauthbearerAwsExternalId,
      key,
      secret,
      schemaRegistryUrl,
      sslCaPem,
    };
  }

  if (connectionType === "s3") {
    if (
      bootstrapServers ||
      securityProtocol ||
      saslMechanism ||
      saslOauthbearerMethod ||
      saslOauthbearerAwsRegion ||
      saslOauthbearerAwsRoleArn ||
      saslOauthbearerAwsExternalId ||
      key ||
      secret ||
      schemaRegistryUrl ||
      sslCaPem ||
      serviceAccountCredentialsJson ||
      dynamodbArn ||
      dynamodbRegion
    ) {
      throw new MigrationParseError(
        resource.filePath,
        "connection",
        resource.name,
        "Kafka/GCS/DynamoDB directives are not valid for s3 connections."
      );
    }

    if (!region) {
      throw new MigrationParseError(
        resource.filePath,
        "connection",
        resource.name,
        "S3_REGION is required for s3 connections."
      );
    }

    if (!arn && !(accessKey && accessSecret)) {
      throw new MigrationParseError(
        resource.filePath,
        "connection",
        resource.name,
        "S3 connections require S3_ARN or both S3_ACCESS_KEY and S3_SECRET."
      );
    }

    if ((accessKey && !accessSecret) || (!accessKey && accessSecret)) {
      throw new MigrationParseError(
        resource.filePath,
        "connection",
        resource.name,
        "S3_ACCESS_KEY and S3_SECRET must be provided together."
      );
    }

    return {
      kind: "connection",
      name: resource.name,
      filePath: resource.filePath,
      connectionType: "s3",
      region,
      arn,
      accessKey,
      secret: accessSecret,
    };
  }

  if (connectionType === "gcs") {
    if (
      bootstrapServers ||
      securityProtocol ||
      saslMechanism ||
      saslOauthbearerMethod ||
      saslOauthbearerAwsRegion ||
      saslOauthbearerAwsRoleArn ||
      saslOauthbearerAwsExternalId ||
      key ||
      secret ||
      schemaRegistryUrl ||
      sslCaPem ||
      region ||
      arn ||
      accessKey ||
      accessSecret ||
      dynamodbArn ||
      dynamodbRegion
    ) {
      throw new MigrationParseError(
        resource.filePath,
        "connection",
        resource.name,
        "Kafka/S3/DynamoDB directives are not valid for gcs connections."
      );
    }

    if (!serviceAccountCredentialsJson) {
      throw new MigrationParseError(
        resource.filePath,
        "connection",
        resource.name,
        "GCS_SERVICE_ACCOUNT_CREDENTIALS_JSON is required for gcs connections."
      );
    }

    return {
      kind: "connection",
      name: resource.name,
      filePath: resource.filePath,
      connectionType: "gcs",
      serviceAccountCredentialsJson,
    };
  }

  if (connectionType === "dynamodb") {
    if (
      bootstrapServers ||
      securityProtocol ||
      saslMechanism ||
      saslOauthbearerMethod ||
      saslOauthbearerAwsRegion ||
      saslOauthbearerAwsRoleArn ||
      saslOauthbearerAwsExternalId ||
      key ||
      secret ||
      schemaRegistryUrl ||
      sslCaPem ||
      region ||
      arn ||
      accessKey ||
      accessSecret ||
      serviceAccountCredentialsJson
    ) {
      throw new MigrationParseError(
        resource.filePath,
        "connection",
        resource.name,
        "Kafka/S3/GCS directives are not valid for dynamodb connections."
      );
    }

    if (!dynamodbArn) {
      throw new MigrationParseError(
        resource.filePath,
        "connection",
        resource.name,
        "DYNAMODB_ARN is required for dynamodb connections."
      );
    }

    if (!dynamodbRegion) {
      throw new MigrationParseError(
        resource.filePath,
        "connection",
        resource.name,
        "DYNAMODB_REGION is required for dynamodb connections."
      );
    }

    return {
      kind: "connection",
      name: resource.name,
      filePath: resource.filePath,
      connectionType: "dynamodb",
      arn: dynamodbArn,
      region: dynamodbRegion,
    };
  }

  throw new MigrationParseError(
    resource.filePath,
    "connection",
    resource.name,
    `Unsupported connection type in strict mode: "${connectionType}"`
  );
}
