import { clickhouseTypeToValidator } from "../codegen/type-mapper.js";
import { toCamelCase } from "../codegen/utils.js";
import { parseLiteralFromDatafile, toTsLiteral } from "./parser-utils.js";
import type {
  DatasourceModel,
  DatasourceEngineModel,
  DynamoDBConnectionModel,
  GCSConnectionModel,
  KafkaConnectionModel,
  ParsedResource,
  PipeModel,
  S3ConnectionModel,
} from "./types.js";

function escapeString(value: string): string {
  return JSON.stringify(value);
}

function escapeTemplateLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\${/g, "\\${");
}

function emitObjectKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : escapeString(key);
}

interface ParsedSecretTemplate {
  name: string;
  defaultValue?: string;
}

function parseTbSecretTemplate(value: string): ParsedSecretTemplate | null {
  const trimmed = value.trim();
  const regex =
    /^\{\{\s*tb_secret\(\s*["']([^"']+)["'](?:\s*,\s*["']([^"']*)["'])?\s*\)\s*\}\}$/;
  const match = trimmed.match(regex);
  if (!match) {
    return null;
  }
  return {
    name: match[1] ?? "",
    defaultValue: match[2],
  };
}

function emitStringOrSecret(value: string): string {
  const parsed = parseTbSecretTemplate(value);
  if (!parsed) {
    return escapeString(value);
  }
  if (parsed.defaultValue !== undefined) {
    return `secret(${escapeString(parsed.name)}, ${escapeString(parsed.defaultValue)})`;
  }
  return `secret(${escapeString(parsed.name)})`;
}

function hasSecretTemplate(resources: ParsedResource[]): boolean {
  const values: string[] = [];

  for (const resource of resources) {
    if (resource.kind === "connection") {
      if (resource.connectionType === "kafka") {
        values.push(resource.bootstrapServers);
        if (resource.key) values.push(resource.key);
        if (resource.secret) values.push(resource.secret);
        if (resource.sslCaPem) values.push(resource.sslCaPem);
        if (resource.schemaRegistryUrl) values.push(resource.schemaRegistryUrl);
        if (resource.saslOauthbearerAwsRegion) values.push(resource.saslOauthbearerAwsRegion);
        if (resource.saslOauthbearerAwsRoleArn) values.push(resource.saslOauthbearerAwsRoleArn);
        if (resource.saslOauthbearerAwsExternalId) values.push(resource.saslOauthbearerAwsExternalId);
      } else if (resource.connectionType === "s3") {
        values.push(resource.region);
        if (resource.arn) values.push(resource.arn);
        if (resource.accessKey) values.push(resource.accessKey);
        if (resource.secret) values.push(resource.secret);
      } else if (resource.connectionType === "dynamodb") {
        values.push(resource.region);
        values.push(resource.arn);
      } else {
        values.push(resource.serviceAccountCredentialsJson);
      }
      continue;
    }

    if (resource.kind === "datasource") {
      if (resource.description) values.push(resource.description);
      if (resource.kafka) {
        values.push(resource.kafka.topic);
        if (resource.kafka.groupId) values.push(resource.kafka.groupId);
        if (resource.kafka.autoOffsetReset) values.push(resource.kafka.autoOffsetReset);
      }
      if (resource.s3) {
        values.push(resource.s3.bucketUri);
        if (resource.s3.schedule) values.push(resource.s3.schedule);
        if (resource.s3.fromTimestamp) values.push(resource.s3.fromTimestamp);
      }
      if (resource.gcs) {
        values.push(resource.gcs.bucketUri);
        if (resource.gcs.schedule) values.push(resource.gcs.schedule);
        if (resource.gcs.fromTimestamp) values.push(resource.gcs.fromTimestamp);
      }
      if (resource.dynamodb) {
        values.push(resource.dynamodb.tableArn);
        values.push(resource.dynamodb.exportBucket);
      }
      continue;
    }
  }

  return values.some((value) => parseTbSecretTemplate(value) !== null);
}

function normalizedBaseType(type: string): string {
  let current = type.trim();
  let updated = true;
  while (updated) {
    updated = false;
    const nullable = current.match(/^Nullable\((.+)\)$/);
    if (nullable?.[1]) {
      current = nullable[1];
      updated = true;
      continue;
    }
    const lowCard = current.match(/^LowCardinality\((.+)\)$/);
    if (lowCard?.[1]) {
      current = lowCard[1];
      updated = true;
      continue;
    }
  }
  return current;
}

function isBooleanType(type: string): boolean {
  const base = normalizedBaseType(type);
  return base === "Bool" || base === "Boolean";
}

function strictColumnTypeToValidator(type: string): string {
  const validator = clickhouseTypeToValidator(type);
  if (validator.includes("TODO: Unknown type") || validator.includes("/*")) {
    throw new Error(`Unsupported column type in strict mode: "${type}"`);
  }
  return validator;
}

function strictParamBaseValidator(type: string): string {
  const map: Record<string, string> = {
    String: "p.string()",
    UUID: "p.uuid()",
    Int: "p.int32()",
    Integer: "p.int32()",
    Int8: "p.int8()",
    Int16: "p.int16()",
    Int32: "p.int32()",
    Int64: "p.int64()",
    UInt8: "p.uint8()",
    UInt16: "p.uint16()",
    UInt32: "p.uint32()",
    UInt64: "p.uint64()",
    Float32: "p.float32()",
    Float64: "p.float64()",
    Boolean: "p.boolean()",
    Bool: "p.boolean()",
    Date: "p.date()",
    DateTime: "p.dateTime()",
    DateTime64: "p.dateTime64()",
    Array: "p.array(p.string())",
    column: "p.column()",
    JSON: "p.json()",
  };
  const validator = map[type];
  if (!validator) {
    throw new Error(`Unsupported parameter type in strict mode: "${type}"`);
  }
  return validator;
}

function applyParamOptional(
  baseValidator: string,
  required: boolean,
  defaultValue: string | number | boolean | undefined
): string {
  const withDefault = defaultValue !== undefined;
  if (!withDefault && required) {
    return baseValidator;
  }

  const optionalSuffix = withDefault
    ? `.optional(${typeof defaultValue === "string" ? JSON.stringify(defaultValue) : defaultValue})`
    : ".optional()";

  if (baseValidator.endsWith(")")) {
    return `${baseValidator}${optionalSuffix}`;
  }
  return `${baseValidator}${optionalSuffix}`;
}

function applyParamDescription(validator: string, description: string | undefined): string {
  if (description === undefined) {
    return validator;
  }
  return `${validator}.describe(${JSON.stringify(description)})`;
}

function engineFunctionName(type: string): string {
  const map: Record<string, string> = {
    MergeTree: "mergeTree",
    ReplacingMergeTree: "replacingMergeTree",
    SummingMergeTree: "summingMergeTree",
    AggregatingMergeTree: "aggregatingMergeTree",
    CollapsingMergeTree: "collapsingMergeTree",
    VersionedCollapsingMergeTree: "versionedCollapsingMergeTree",
    Null: "null",
  };
  const functionName = map[type];
  if (!functionName) {
    throw new Error(`Unsupported engine type in strict mode: "${type}"`);
  }
  return functionName;
}

function emitEngineOptions(engine: DatasourceEngineModel): string {
  if (engine.type === "Null") {
    return "engine.null()";
  }

  const options: string[] = [];

  if (engine.sortingKey.length === 1) {
    options.push(`sortingKey: ${escapeString(engine.sortingKey[0]!)}`);
  } else {
    options.push(
      `sortingKey: [${engine.sortingKey.map((k) => escapeString(k)).join(", ")}]`
    );
  }

  if (engine.partitionKey) {
    options.push(`partitionKey: ${escapeString(engine.partitionKey)}`);
  }
  if (engine.primaryKey && engine.primaryKey.length > 0) {
    if (engine.primaryKey.length === 1) {
      options.push(`primaryKey: ${escapeString(engine.primaryKey[0]!)}`);
    } else {
      options.push(
        `primaryKey: [${engine.primaryKey.map((k) => escapeString(k)).join(", ")}]`
      );
    }
  }
  if (engine.ttl) {
    options.push(`ttl: ${escapeString(engine.ttl)}`);
  }
  if (engine.ver) {
    options.push(`ver: ${escapeString(engine.ver)}`);
  }
  if (engine.isDeleted) {
    options.push(`isDeleted: ${escapeString(engine.isDeleted)}`);
  }
  if (engine.sign) {
    options.push(`sign: ${escapeString(engine.sign)}`);
  }
  if (engine.version) {
    options.push(`version: ${escapeString(engine.version)}`);
  }
  if (engine.summingColumns && engine.summingColumns.length > 0) {
    options.push(
      `columns: [${engine.summingColumns.map((k) => escapeString(k)).join(", ")}]`
    );
  }
  if (engine.settings && Object.keys(engine.settings).length > 0) {
    const settingsEntries = Object.entries(engine.settings).map(([k, v]) => {
      if (typeof v === "string") {
        return `${escapeString(k)}: ${escapeString(v)}`;
      }
      return `${escapeString(k)}: ${v}`;
    });
    options.push(`settings: { ${settingsEntries.join(", ")} }`);
  }

  const engineFn = engineFunctionName(engine.type);
  return `engine.${engineFn}({ ${options.join(", ")} })`;
}

function emitDatasource(ds: DatasourceModel): string {
  const variableName = toCamelCase(ds.name);
  const lines: string[] = [];
  const hasJsonPath = ds.columns.some((column) => column.jsonPath !== undefined);

  if (ds.description) {
    lines.push("/**");
    for (const row of ds.description.split("\n")) {
      lines.push(` * ${row}`);
    }
    lines.push(" */");
  }

  lines.push(`export const ${variableName} = defineDatasource(${escapeString(ds.name)}, {`);
  if (ds.description !== undefined) {
    lines.push(`  description: ${emitStringOrSecret(ds.description)},`);
  }
  if (!hasJsonPath) {
    lines.push("  jsonPaths: false,");
  }

  lines.push("  schema: {");
  for (const column of ds.columns) {
    let validator = strictColumnTypeToValidator(column.type);
    const columnKey = emitObjectKey(column.name);

    if (column.defaultExpression !== undefined) {
      try {
        const parsedDefault = parseLiteralFromDatafile(column.defaultExpression);
        let literalValue = parsedDefault;
        if (typeof parsedDefault === "number" && isBooleanType(column.type)) {
          if (parsedDefault === 0 || parsedDefault === 1) {
            literalValue = parsedDefault === 1;
          } else {
            throw new Error(
              `Boolean default value must be 0 or 1 for column "${column.name}" in datasource "${ds.name}".`
            );
          }
        }
        validator += `.default(${toTsLiteral(
          literalValue as string | number | boolean | null | Record<string, unknown> | unknown[]
        )})`;
      } catch {
        validator += `.defaultExpr(${escapeString(column.defaultExpression)})`;
      }
    }

    if (column.codec) {
      validator += `.codec(${escapeString(column.codec)})`;
    }

    if (column.jsonPath) {
      validator += `.jsonPath(${escapeString(column.jsonPath)})`;
    }
    lines.push(`    ${columnKey}: ${validator},`);
  }
  lines.push("  },");
  if (ds.engine) {
    lines.push(`  engine: ${emitEngineOptions(ds.engine)},`);
  }
  if (ds.indexes.length > 0) {
    lines.push("  indexes: [");
    for (const index of ds.indexes) {
      lines.push(
        `    { name: ${escapeString(index.name)}, expr: ${escapeString(index.expr)}, type: ${escapeString(index.type)}, granularity: ${index.granularity} },`
      );
    }
    lines.push("  ],");
  }

  if (ds.kafka) {
    const connectionVar = toCamelCase(ds.kafka.connectionName);
    lines.push("  kafka: {");
    lines.push(`    connection: ${connectionVar},`);
    lines.push(`    topic: ${emitStringOrSecret(ds.kafka.topic)},`);
    if (ds.kafka.groupId) {
      lines.push(`    groupId: ${emitStringOrSecret(ds.kafka.groupId)},`);
    }
    if (ds.kafka.autoOffsetReset) {
      lines.push(`    autoOffsetReset: ${emitStringOrSecret(ds.kafka.autoOffsetReset)},`);
    }
    if (ds.kafka.storeRawValue !== undefined) {
      lines.push(`    storeRawValue: ${ds.kafka.storeRawValue},`);
    }
    lines.push("  },");
  }

  if (ds.s3) {
    const connectionVar = toCamelCase(ds.s3.connectionName);
    lines.push("  s3: {");
    lines.push(`    connection: ${connectionVar},`);
    lines.push(`    bucketUri: ${emitStringOrSecret(ds.s3.bucketUri)},`);
    if (ds.s3.schedule) {
      lines.push(`    schedule: ${emitStringOrSecret(ds.s3.schedule)},`);
    }
    if (ds.s3.fromTimestamp) {
      lines.push(`    fromTimestamp: ${emitStringOrSecret(ds.s3.fromTimestamp)},`);
    }
    lines.push("  },");
  }

  if (ds.gcs) {
    const connectionVar = toCamelCase(ds.gcs.connectionName);
    lines.push("  gcs: {");
    lines.push(`    connection: ${connectionVar},`);
    lines.push(`    bucketUri: ${emitStringOrSecret(ds.gcs.bucketUri)},`);
    if (ds.gcs.schedule) {
      lines.push(`    schedule: ${emitStringOrSecret(ds.gcs.schedule)},`);
    }
    if (ds.gcs.fromTimestamp) {
      lines.push(`    fromTimestamp: ${emitStringOrSecret(ds.gcs.fromTimestamp)},`);
    }
    lines.push("  },");
  }

  if (ds.dynamodb) {
    const connectionVar = toCamelCase(ds.dynamodb.connectionName);
    lines.push("  dynamodb: {");
    lines.push(`    connection: ${connectionVar},`);
    lines.push(`    tableArn: ${emitStringOrSecret(ds.dynamodb.tableArn)},`);
    lines.push(`    exportBucket: ${emitStringOrSecret(ds.dynamodb.exportBucket)},`);
    lines.push("  },");
  }

  if (ds.forwardQuery) {
    lines.push("  forwardQuery: `");
    lines.push(escapeTemplateLiteral(ds.forwardQuery));
    lines.push("  `,");
  }

  if (ds.tokens.length > 0) {
    lines.push("  tokens: [");
    for (const token of ds.tokens) {
      lines.push(
        `    { name: ${escapeString(token.name)}, permissions: [${escapeString(token.scope)}] },`
      );
    }
    lines.push("  ],");
  }

  if (ds.sharedWith.length > 0) {
    lines.push(
      `  sharedWith: [${ds.sharedWith.map((workspace) => escapeString(workspace)).join(", ")}],`
    );
  }

  lines.push("});");
  lines.push("");
  return lines.join("\n");
}

function emitConnection(
  connection:
    | KafkaConnectionModel
    | S3ConnectionModel
    | GCSConnectionModel
    | DynamoDBConnectionModel
): string {
  const variableName = toCamelCase(connection.name);
  const lines: string[] = [];

  if (connection.connectionType === "kafka") {
    lines.push(
      `export const ${variableName} = defineKafkaConnection(${escapeString(connection.name)}, {`
    );
    lines.push(`  bootstrapServers: ${emitStringOrSecret(connection.bootstrapServers)},`);
    if (connection.securityProtocol) {
      lines.push(`  securityProtocol: ${emitStringOrSecret(connection.securityProtocol)},`);
    }
    if (connection.saslMechanism) {
      lines.push(`  saslMechanism: ${emitStringOrSecret(connection.saslMechanism)},`);
    }
    if (connection.saslOauthbearerMethod) {
      lines.push(`  saslOauthbearerMethod: ${emitStringOrSecret(connection.saslOauthbearerMethod)},`);
    }
    if (connection.saslOauthbearerAwsRegion) {
      lines.push(
        `  saslOauthbearerAwsRegion: ${emitStringOrSecret(connection.saslOauthbearerAwsRegion)},`
      );
    }
    if (connection.saslOauthbearerAwsRoleArn) {
      lines.push(
        `  saslOauthbearerAwsRoleArn: ${emitStringOrSecret(connection.saslOauthbearerAwsRoleArn)},`
      );
    }
    if (connection.saslOauthbearerAwsExternalId) {
      lines.push(
        `  saslOauthbearerAwsExternalId: ${emitStringOrSecret(connection.saslOauthbearerAwsExternalId)},`
      );
    }
    if (connection.key) {
      lines.push(`  key: ${emitStringOrSecret(connection.key)},`);
    }
    if (connection.secret) {
      lines.push(`  secret: ${emitStringOrSecret(connection.secret)},`);
    }
    if (connection.schemaRegistryUrl) {
      lines.push(`  schemaRegistryUrl: ${emitStringOrSecret(connection.schemaRegistryUrl)},`);
    }
    if (connection.sslCaPem) {
      lines.push(`  sslCaPem: ${emitStringOrSecret(connection.sslCaPem)},`);
    }
    lines.push("});");
    lines.push("");
    return lines.join("\n");
  }

  if (connection.connectionType === "s3") {
    lines.push(
      `export const ${variableName} = defineS3Connection(${escapeString(connection.name)}, {`
    );
    lines.push(`  region: ${emitStringOrSecret(connection.region)},`);
    if (connection.arn) {
      lines.push(`  arn: ${emitStringOrSecret(connection.arn)},`);
    }
    if (connection.accessKey) {
      lines.push(`  accessKey: ${emitStringOrSecret(connection.accessKey)},`);
    }
    if (connection.secret) {
      lines.push(`  secret: ${emitStringOrSecret(connection.secret)},`);
    }
    lines.push("});");
    lines.push("");
    return lines.join("\n");
  }

  if (connection.connectionType === "dynamodb") {
    lines.push(
      `export const ${variableName} = defineDynamoDBConnection(${escapeString(connection.name)}, {`
    );
    lines.push(`  region: ${emitStringOrSecret(connection.region)},`);
    lines.push(`  arn: ${emitStringOrSecret(connection.arn)},`);
    lines.push("});");
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    `export const ${variableName} = defineGCSConnection(${escapeString(connection.name)}, {`
  );
  lines.push(
    `  serviceAccountCredentialsJson: ${emitStringOrSecret(connection.serviceAccountCredentialsJson)},`
  );
  lines.push("});");
  lines.push("");
  return lines.join("\n");
}

function emitPipe(pipe: PipeModel): string {
  const variableName = toCamelCase(pipe.name);
  const lines: string[] = [];
  const endpointOutputColumns =
    pipe.inferredOutputColumns.length > 0 ? pipe.inferredOutputColumns : ["result"];

  if (pipe.description) {
    lines.push("/**");
    for (const row of pipe.description.split("\n")) {
      lines.push(` * ${row}`);
    }
    lines.push(" */");
  }

  if (pipe.type === "materialized") {
    lines.push(`export const ${variableName} = defineMaterializedView(${escapeString(pipe.name)}, {`);
  } else if (pipe.type === "copy") {
    lines.push(`export const ${variableName} = defineCopyPipe(${escapeString(pipe.name)}, {`);
  } else if (pipe.type === "sink") {
    lines.push(`export const ${variableName} = defineSinkPipe(${escapeString(pipe.name)}, {`);
  } else {
    lines.push(`export const ${variableName} = definePipe(${escapeString(pipe.name)}, {`);
  }

  if (pipe.description !== undefined) {
    lines.push(`  description: ${escapeString(pipe.description)},`);
  }

  if (pipe.type === "pipe" || pipe.type === "endpoint" || pipe.type === "sink") {
    if (pipe.params.length > 0) {
      lines.push("  params: {");
      for (const param of pipe.params) {
        const baseValidator = strictParamBaseValidator(param.type);
        const validatorWithOptional = applyParamOptional(
          baseValidator,
          param.required,
          param.defaultValue
        );
        const validator = applyParamDescription(validatorWithOptional, param.description);
        lines.push(`    ${emitObjectKey(param.name)}: ${validator},`);
      }
      lines.push("  },");
    }
  }

  if (pipe.type === "materialized") {
    lines.push(`  datasource: ${toCamelCase(pipe.materializedDatasource ?? "")},`);
    if (pipe.deploymentMethod) {
      lines.push(`  deploymentMethod: ${escapeString(pipe.deploymentMethod)},`);
    }
  }

  if (pipe.type === "copy") {
    lines.push(`  datasource: ${toCamelCase(pipe.copyTargetDatasource ?? "")},`);
    if (pipe.copyMode) {
      lines.push(`  copy_mode: ${escapeString(pipe.copyMode)},`);
    }
    if (pipe.copySchedule) {
      lines.push(`  copy_schedule: ${escapeString(pipe.copySchedule)},`);
    }
  }

  if (pipe.type === "sink") {
    if (!pipe.sink) {
      throw new Error(`Sink pipe "${pipe.name}" is missing sink configuration.`);
    }
    lines.push("  sink: {");
    lines.push(`    connection: ${toCamelCase(pipe.sink.connectionName)},`);
    if (pipe.sink.service === "kafka") {
      lines.push(`    topic: ${escapeString(pipe.sink.topic)},`);
      lines.push(`    schedule: ${escapeString(pipe.sink.schedule)},`);
    } else {
      lines.push(`    bucketUri: ${escapeString(pipe.sink.bucketUri)},`);
      lines.push(`    fileTemplate: ${escapeString(pipe.sink.fileTemplate)},`);
      lines.push(`    schedule: ${escapeString(pipe.sink.schedule)},`);
      lines.push(`    format: ${escapeString(pipe.sink.format)},`);
      if (pipe.sink.strategy) {
        lines.push(`    strategy: ${escapeString(pipe.sink.strategy)},`);
      }
      if (pipe.sink.compression) {
        lines.push(`    compression: ${escapeString(pipe.sink.compression)},`);
      }
    }
    lines.push("  },");
  }

  lines.push("  nodes: [");
  for (const node of pipe.nodes) {
    lines.push("    node({");
    lines.push(`      name: ${escapeString(node.name)},`);
    if (node.description !== undefined) {
      lines.push(`      description: ${escapeString(node.description)},`);
    }
    lines.push("      sql: `");
    lines.push(escapeTemplateLiteral(node.sql));
    lines.push("      `,");
    lines.push("    }),");
  }
  lines.push("  ],");

  if (pipe.type === "endpoint") {
    if (pipe.cacheTtl !== undefined) {
      lines.push(`  endpoint: { enabled: true, cache: { enabled: true, ttl: ${pipe.cacheTtl} } },`);
    } else {
      lines.push("  endpoint: true,");
    }
    lines.push("  output: {");
    for (const columnName of endpointOutputColumns) {
      lines.push(`    ${emitObjectKey(columnName)}: t.string(),`);
    }
    lines.push("  },");
  }

  if (pipe.tokens.length > 0) {
    lines.push("  tokens: [");
    for (const token of pipe.tokens) {
      lines.push(`    { name: ${escapeString(token.name)} },`);
    }
    lines.push("  ],");
  }

  lines.push("});");
  lines.push("");
  return lines.join("\n");
}

export function emitMigrationFileContent(resources: ParsedResource[]): string {
  const connections = resources.filter(
    (
      resource
    ): resource is
      | KafkaConnectionModel
      | S3ConnectionModel
      | GCSConnectionModel
      | DynamoDBConnectionModel => resource.kind === "connection"
  );
  const datasources = resources.filter(
    (resource): resource is DatasourceModel => resource.kind === "datasource"
  );
  const pipes = resources.filter(
    (resource): resource is PipeModel => resource.kind === "pipe"
  );

  const needsParams = pipes.some((pipe) => pipe.params.length > 0);
  const needsSecret = hasSecretTemplate(resources);

  const imports = new Set<string>([
    "defineDatasource",
    "definePipe",
    "defineMaterializedView",
    "defineCopyPipe",
    "node",
    "t",
  ]);
  if (connections.some((connection) => connection.connectionType === "kafka")) {
    imports.add("defineKafkaConnection");
  }
  if (connections.some((connection) => connection.connectionType === "s3")) {
    imports.add("defineS3Connection");
  }
  if (connections.some((connection) => connection.connectionType === "gcs")) {
    imports.add("defineGCSConnection");
  }
  if (connections.some((connection) => connection.connectionType === "dynamodb")) {
    imports.add("defineDynamoDBConnection");
  }
  if (needsParams) {
    imports.add("p");
  }
  if (pipes.some((pipe) => pipe.type === "sink")) {
    imports.add("defineSinkPipe");
  }
  if (datasources.some((datasource) => datasource.engine !== undefined)) {
    imports.add("engine");
  }
  if (needsSecret) {
    imports.add("secret");
  }

  const orderedImports = [
    "defineKafkaConnection",
    "defineS3Connection",
    "defineGCSConnection",
    "defineDynamoDBConnection",
    "defineDatasource",
    "definePipe",
    "defineMaterializedView",
    "defineCopyPipe",
    "defineSinkPipe",
    "node",
    "t",
    "engine",
    "secret",
    "p",
  ].filter((name) => imports.has(name));

  const lines: string[] = [];
  lines.push("/**");
  lines.push(" * Generated by tinybird migrate.");
  lines.push(" * Review endpoint output schemas and any defaults before production use.");
  lines.push(" */");
  lines.push("");
  lines.push(`import { ${orderedImports.join(", ")} } from "@tinybirdco/sdk";`);
  lines.push("");

  if (connections.length > 0) {
    lines.push("// Connections");
    lines.push("");
    for (const connection of connections) {
      lines.push(emitConnection(connection));
    }
  }

  if (datasources.length > 0) {
    lines.push("// Datasources");
    lines.push("");
    for (const datasource of datasources) {
      lines.push(emitDatasource(datasource));
    }
  }

  if (pipes.length > 0) {
    lines.push("// Pipes");
    lines.push("");
    for (const pipe of pipes) {
      lines.push(emitPipe(pipe));
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function validateResourceForEmission(resource: ParsedResource): void {
  if (resource.kind === "connection") {
    emitConnection(resource);
    return;
  }
  if (resource.kind === "datasource") {
    emitDatasource(resource);
    return;
  }
  emitPipe(resource);
}
