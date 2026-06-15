import type {
  DatasourceIndexModel,
  DatasourceModel,
  DatasourceTokenModel,
  ResourceFile,
} from "./types.js";
import {
  MigrationParseError,
  isBlank,
  parseDirectiveLine,
  parseQuotedValue,
  readDirectiveBlock,
  splitCommaSeparated,
  splitLines,
  splitTopLevelComma,
} from "./parser-utils.js";

const DATASOURCE_DIRECTIVES = new Set([
  "DESCRIPTION",
  "SCHEMA",
  "FORWARD_QUERY",
  "INDEXES",
  "SHARED_WITH",
  "ENGINE",
  "ENGINE_SORTING_KEY",
  "ENGINE_PARTITION_KEY",
  "ENGINE_PRIMARY_KEY",
  "ENGINE_TTL",
  "ENGINE_VER",
  "ENGINE_SIGN",
  "ENGINE_VERSION",
  "ENGINE_SUMMING_COLUMNS",
  "ENGINE_SETTINGS",
  "KAFKA_CONNECTION_NAME",
  "KAFKA_TOPIC",
  "KAFKA_GROUP_ID",
  "KAFKA_AUTO_OFFSET_RESET",
  "IMPORT_CONNECTION_NAME",
  "IMPORT_BUCKET_URI",
  "IMPORT_SCHEDULE",
  "IMPORT_FROM_TIMESTAMP",
  "IMPORT_TABLE_ARN",
  "IMPORT_EXPORT_BUCKET",
  "TOKEN",
]);

function isDatasourceDirectiveLine(line: string): boolean {
  if (!line) {
    return false;
  }
  const { key } = parseDirectiveLine(line);
  return DATASOURCE_DIRECTIVES.has(key);
}

function findTokenOutsideContexts(input: string, token: string): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i <= input.length - token.length; i += 1) {
    const char = input[i];
    const prev = i > 0 ? input[i - 1] : "";

    if (char === "'" && !inDouble && !inBacktick && prev !== "\\") {
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle && !inBacktick && prev !== "\\") {
      inDouble = !inDouble;
    } else if (char === "`" && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
    } else if (!inSingle && !inDouble && !inBacktick) {
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
      }
    }

    if (!inSingle && !inDouble && !inBacktick && depth === 0) {
      if (input.slice(i, i + token.length) === token) {
        return i;
      }
    }
  }

  return -1;
}

function parseColumnLine(filePath: string, resourceName: string, rawLine: string) {
  const line = rawLine.trim().replace(/,$/, "");
  if (!line) {
    throw new MigrationParseError(filePath, "datasource", resourceName, "Empty schema line.");
  }

  const firstSpace = line.search(/\s/);
  if (firstSpace === -1) {
    throw new MigrationParseError(
      filePath,
      "datasource",
      resourceName,
      `Invalid schema column definition: "${rawLine}"`
    );
  }

  const rawColumnName = line.slice(0, firstSpace).trim();
  const columnName = normalizeColumnName(rawColumnName);
  let rest = line.slice(firstSpace + 1).trim();

  if (!columnName) {
    throw new MigrationParseError(
      filePath,
      "datasource",
      resourceName,
      `Invalid schema column name: "${rawLine}"`
    );
  }

  const codecMatch = rest.match(/\s+CODEC\((.+)\)\s*$/);
  const codec = codecMatch ? codecMatch[1].trim() : undefined;
  if (codecMatch?.index !== undefined) {
    rest = rest.slice(0, codecMatch.index).trim();
  }

  let defaultExpression: string | undefined;
  const defaultMarkerIndex = findTokenOutsideContexts(rest, " DEFAULT ");
  if (defaultMarkerIndex >= 0) {
    defaultExpression = rest.slice(defaultMarkerIndex + " DEFAULT ".length).trim();
    rest = rest.slice(0, defaultMarkerIndex).trim();
  }

  let jsonPath: string | undefined;
  const jsonMatch = rest.match(/`json:([^`]+)`/);
  if (jsonMatch) {
    jsonPath = jsonMatch[1].trim();
    rest = rest.replace(/`json:[^`]+`/, "").trim();
  }

  if (!rest) {
    throw new MigrationParseError(
      filePath,
      "datasource",
      resourceName,
      `Missing type in schema column: "${rawLine}"`
    );
  }

  return {
    name: columnName,
    type: rest,
    jsonPath,
    defaultExpression,
    codec,
  };
}

function normalizeColumnName(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("`") && trimmed.endsWith("`")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEngineSettings(value: string): Record<string, string | number | boolean> {
  const raw = parseQuotedValue(value);
  const parts = splitTopLevelComma(raw);
  const settings: Record<string, string | number | boolean> = {};

  for (const part of parts) {
    const equalIndex = part.indexOf("=");
    if (equalIndex === -1) {
      throw new Error(`Invalid ENGINE_SETTINGS part: "${part}"`);
    }
    const key = part.slice(0, equalIndex).trim();
    const rawValue = part.slice(equalIndex + 1).trim();
    if (!key) {
      throw new Error(`Invalid ENGINE_SETTINGS key in "${part}"`);
    }

    if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
      settings[key] = rawValue.slice(1, -1).replace(/\\'/g, "'");
      continue;
    }
    if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
      settings[key] = Number(rawValue);
      continue;
    }
    if (rawValue === "true") {
      settings[key] = true;
      continue;
    }
    if (rawValue === "false") {
      settings[key] = false;
      continue;
    }

    throw new Error(`Unsupported ENGINE_SETTINGS value: "${rawValue}"`);
  }

  return settings;
}

function parseToken(filePath: string, resourceName: string, value: string): DatasourceTokenModel {
  const trimmed = value.trim();
  const quotedMatch = trimmed.match(/^"([^"]+)"\s+(READ|APPEND)$/);
  if (quotedMatch) {
    const name = quotedMatch[1];
    const scope = quotedMatch[2] as "READ" | "APPEND";
    return { name, scope };
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    throw new MigrationParseError(
      filePath,
      "datasource",
      resourceName,
      `Invalid TOKEN line: "${value}"`
    );
  }

  if (parts.length > 2) {
    throw new MigrationParseError(
      filePath,
      "datasource",
      resourceName,
      `Unsupported TOKEN syntax in strict mode: "${value}"`
    );
  }

  const rawName = parts[0] ?? "";
  const name =
    rawName.startsWith('"') && rawName.endsWith('"') && rawName.length >= 2
      ? rawName.slice(1, -1)
      : rawName;
  const scope = parts[1];
  if (scope !== "READ" && scope !== "APPEND") {
    throw new MigrationParseError(
      filePath,
      "datasource",
      resourceName,
      `Unsupported datasource token scope: "${scope}"`
    );
  }

  return { name, scope };
}

function parseIndexLine(
  filePath: string,
  resourceName: string,
  rawLine: string
): DatasourceIndexModel {
  const line = rawLine.trim().replace(/,$/, "");
  if (!line) {
    throw new MigrationParseError(
      filePath,
      "datasource",
      resourceName,
      "Empty INDEXES line."
    );
  }

  const match = line.match(/^(\S+)\s+(.+?)\s+TYPE\s+(.+?)\s+GRANULARITY\s+(\d+)$/i);
  if (!match) {
    throw new MigrationParseError(
      filePath,
      "datasource",
      resourceName,
      `Invalid INDEXES definition: "${rawLine}"`
    );
  }

  const granularity = Number(match[4]);
  if (!Number.isInteger(granularity) || granularity <= 0) {
    throw new MigrationParseError(
      filePath,
      "datasource",
      resourceName,
      `Invalid INDEXES GRANULARITY value: "${match[4]}"`
    );
  }

  return {
    name: match[1],
    expr: match[2].trim(),
    type: match[3].trim(),
    granularity,
  };
}

export function parseDatasourceFile(resource: ResourceFile): DatasourceModel {
  const lines = splitLines(resource.content);
  const columns = [];
  const indexes: DatasourceIndexModel[] = [];
  const tokens: DatasourceTokenModel[] = [];
  const sharedWith: string[] = [];
  let description: string | undefined;
  let forwardQuery: string | undefined;

  let engineType: string | undefined;
  let sortingKey: string[] = [];
  let partitionKey: string | undefined;
  let primaryKey: string[] | undefined;
  let ttl: string | undefined;
  let ver: string | undefined;
  let isDeleted: string | undefined;
  let sign: string | undefined;
  let version: string | undefined;
  let summingColumns: string[] | undefined;
  let settings: Record<string, string | number | boolean> | undefined;

  let kafkaConnectionName: string | undefined;
  let kafkaTopic: string | undefined;
  let kafkaGroupId: string | undefined;
  let kafkaAutoOffsetReset: "earliest" | "latest" | undefined;
  let kafkaStoreRawValue: boolean | undefined;

  let importConnectionName: string | undefined;
  let importBucketUri: string | undefined;
  let importSchedule: string | undefined;
  let importFromTimestamp: string | undefined;
  let importTableArn: string | undefined;
  let importExportBucket: string | undefined;

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i] ?? "";
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      i += 1;
      continue;
    }

    if (line === "DESCRIPTION >") {
      const block = readDirectiveBlock(lines, i + 1, isDatasourceDirectiveLine);
      description = block.lines.join("\n");
      i = block.nextIndex;
      continue;
    }

    if (line === "SCHEMA >") {
      const block = readDirectiveBlock(lines, i + 1, isDatasourceDirectiveLine);
      if (block.lines.length === 0) {
        throw new MigrationParseError(
          resource.filePath,
          "datasource",
          resource.name,
          "SCHEMA block is empty."
        );
      }
      for (const schemaLine of block.lines) {
        if (isBlank(schemaLine) || schemaLine.trim().startsWith("#")) {
          continue;
        }
        columns.push(parseColumnLine(resource.filePath, resource.name, schemaLine));
      }
      i = block.nextIndex;
      continue;
    }

    if (line === "FORWARD_QUERY >") {
      const block = readDirectiveBlock(lines, i + 1, isDatasourceDirectiveLine);
      if (block.lines.length === 0) {
        throw new MigrationParseError(
          resource.filePath,
          "datasource",
          resource.name,
          "FORWARD_QUERY block is empty."
        );
      }
      forwardQuery = block.lines.join("\n");
      i = block.nextIndex;
      continue;
    }

    if (line === "INDEXES >") {
      const block = readDirectiveBlock(lines, i + 1, isDatasourceDirectiveLine);
      if (block.lines.length === 0) {
        throw new MigrationParseError(
          resource.filePath,
          "datasource",
          resource.name,
          "INDEXES block is empty."
        );
      }
      for (const indexLine of block.lines) {
        if (isBlank(indexLine) || indexLine.trim().startsWith("#")) {
          continue;
        }
        indexes.push(parseIndexLine(resource.filePath, resource.name, indexLine));
      }
      i = block.nextIndex;
      continue;
    }

    if (line === "SHARED_WITH >") {
      const block = readDirectiveBlock(lines, i + 1, isDatasourceDirectiveLine);
      for (const sharedLine of block.lines) {
        const normalized = sharedLine.trim().replace(/,$/, "");
        if (normalized) {
          sharedWith.push(normalized);
        }
      }
      i = block.nextIndex;
      continue;
    }

    const { key, value } = parseDirectiveLine(line);
    switch (key) {
      case "ENGINE":
        engineType = parseQuotedValue(value);
        break;
      case "ENGINE_SORTING_KEY":
        sortingKey = splitCommaSeparated(parseQuotedValue(value));
        break;
      case "ENGINE_PARTITION_KEY":
        partitionKey = parseQuotedValue(value);
        break;
      case "ENGINE_PRIMARY_KEY":
        primaryKey = splitCommaSeparated(parseQuotedValue(value));
        break;
      case "ENGINE_TTL":
        ttl = parseQuotedValue(value);
        break;
      case "ENGINE_VER":
        ver = parseQuotedValue(value);
        break;
      case "ENGINE_IS_DELETED":
        isDeleted = parseQuotedValue(value);
        break;
      case "ENGINE_SIGN":
        sign = parseQuotedValue(value);
        break;
      case "ENGINE_VERSION":
        version = parseQuotedValue(value);
        break;
      case "ENGINE_SUMMING_COLUMNS":
        summingColumns = splitCommaSeparated(parseQuotedValue(value));
        break;
      case "ENGINE_SETTINGS":
        try {
          settings = parseEngineSettings(value);
        } catch (error) {
          throw new MigrationParseError(
            resource.filePath,
            "datasource",
            resource.name,
            (error as Error).message
          );
        }
        break;
      case "KAFKA_CONNECTION_NAME":
        kafkaConnectionName = value.trim();
        break;
      case "KAFKA_TOPIC":
        kafkaTopic = value.trim();
        break;
      case "KAFKA_GROUP_ID":
        kafkaGroupId = value.trim();
        break;
      case "KAFKA_AUTO_OFFSET_RESET":
        if (value !== "earliest" && value !== "latest") {
          throw new MigrationParseError(
            resource.filePath,
            "datasource",
            resource.name,
            `Invalid KAFKA_AUTO_OFFSET_RESET value: "${value}"`
          );
        }
        kafkaAutoOffsetReset = value;
        break;
      case "KAFKA_STORE_RAW_VALUE": {
        const normalized = value.toLowerCase();
        if (normalized === "true" || normalized === "1") {
          kafkaStoreRawValue = true;
          break;
        }
        if (normalized === "false" || normalized === "0") {
          kafkaStoreRawValue = false;
          break;
        }
        throw new MigrationParseError(
          resource.filePath,
          "datasource",
          resource.name,
          `Invalid KAFKA_STORE_RAW_VALUE value: "${value}"`
        );
      }
      case "IMPORT_CONNECTION_NAME":
        importConnectionName = parseQuotedValue(value);
        break;
      case "IMPORT_BUCKET_URI":
        importBucketUri = parseQuotedValue(value);
        break;
      case "IMPORT_SCHEDULE":
        importSchedule = parseQuotedValue(value);
        break;
      case "IMPORT_FROM_TIMESTAMP":
        importFromTimestamp = parseQuotedValue(value);
        break;
      case "IMPORT_TABLE_ARN":
        importTableArn = parseQuotedValue(value);
        break;
      case "IMPORT_EXPORT_BUCKET":
        importExportBucket = parseQuotedValue(value);
        break;
      case "TOKEN":
        tokens.push(parseToken(resource.filePath, resource.name, value));
        break;
      default:
        throw new MigrationParseError(
          resource.filePath,
          "datasource",
          resource.name,
          `Unsupported datasource directive in strict mode: "${line}"`
        );
    }

    i += 1;
  }

  if (columns.length === 0) {
    throw new MigrationParseError(
      resource.filePath,
      "datasource",
      resource.name,
      "SCHEMA block is required."
    );
  }

  const hasEngineDirectives =
    sortingKey.length > 0 ||
    partitionKey !== undefined ||
    (primaryKey !== undefined && primaryKey.length > 0) ||
    ttl !== undefined ||
    ver !== undefined ||
    isDeleted !== undefined ||
    sign !== undefined ||
    version !== undefined ||
    (summingColumns !== undefined && summingColumns.length > 0) ||
    settings !== undefined;

  if (!engineType && hasEngineDirectives) {
    // Tinybird defaults to MergeTree when ENGINE is omitted.
    // If engine-specific options are present, preserve them by inferring MergeTree.
    engineType = "MergeTree";
  }

  if (engineType && engineType !== "Null" && sortingKey.length === 0) {
    throw new MigrationParseError(
      resource.filePath,
      "datasource",
      resource.name,
      "ENGINE_SORTING_KEY directive is required."
    );
  }

  const kafka =
    kafkaConnectionName ||
    kafkaTopic ||
    kafkaGroupId ||
    kafkaAutoOffsetReset ||
    kafkaStoreRawValue !== undefined
      ? {
          connectionName: kafkaConnectionName ?? "",
          topic: kafkaTopic ?? "",
          groupId: kafkaGroupId,
          autoOffsetReset: kafkaAutoOffsetReset,
          storeRawValue: kafkaStoreRawValue,
        }
      : undefined;

  if (kafka && (!kafka.connectionName || !kafka.topic)) {
    throw new MigrationParseError(
      resource.filePath,
      "datasource",
      resource.name,
      "KAFKA_CONNECTION_NAME and KAFKA_TOPIC are required when Kafka directives are used."
    );
  }

  // DynamoDB import directives share IMPORT_CONNECTION_NAME with blob storage,
  // so treat the import block as DynamoDB whenever a DynamoDB-only directive is present.
  const isDynamoDB = importTableArn !== undefined || importExportBucket !== undefined;

  const dynamodb = isDynamoDB
    ? {
        connectionName: importConnectionName ?? "",
        tableArn: importTableArn ?? "",
        exportBucket: importExportBucket ?? "",
      }
    : undefined;

  if (dynamodb && (!dynamodb.connectionName || !dynamodb.tableArn || !dynamodb.exportBucket)) {
    throw new MigrationParseError(
      resource.filePath,
      "datasource",
      resource.name,
      "IMPORT_CONNECTION_NAME, IMPORT_TABLE_ARN and IMPORT_EXPORT_BUCKET are required when DynamoDB directives are used."
    );
  }

  const s3 =
    !isDynamoDB &&
    (importConnectionName || importBucketUri || importSchedule || importFromTimestamp)
      ? {
          connectionName: importConnectionName ?? "",
          bucketUri: importBucketUri ?? "",
          schedule: importSchedule,
          fromTimestamp: importFromTimestamp,
        }
      : undefined;

  if (s3 && (!s3.connectionName || !s3.bucketUri)) {
    throw new MigrationParseError(
      resource.filePath,
      "datasource",
      resource.name,
      "IMPORT_CONNECTION_NAME and IMPORT_BUCKET_URI are required when import directives are used."
    );
  }

  if (kafka && (s3 || dynamodb)) {
    throw new MigrationParseError(
      resource.filePath,
      "datasource",
      resource.name,
      "Datasource cannot mix Kafka directives with import directives."
    );
  }

  return {
    kind: "datasource",
    name: resource.name,
    filePath: resource.filePath,
    description,
    columns,
    engine: engineType
      ? {
          type: engineType,
          sortingKey,
          partitionKey,
          primaryKey,
          ttl,
          ver,
          isDeleted,
          sign,
          version,
          summingColumns,
          settings,
        }
      : undefined,
    indexes,
    kafka,
    s3,
    dynamodb,
    forwardQuery,
    tokens,
    sharedWith,
  };
}
