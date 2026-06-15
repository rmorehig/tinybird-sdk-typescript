import * as fs from "node:fs";
import * as path from "node:path";
import { discoverResourceFiles } from "../../migrate/discovery.js";
import { emitMigrationFileContent, validateResourceForEmission } from "../../migrate/emit-ts.js";
import { parseResourceFile } from "../../migrate/parse.js";
import { MigrationParseError } from "../../migrate/parser-utils.js";
import type {
  MigrationError,
  MigrationResult,
  ParsedResource,
  ResourceFile,
} from "../../migrate/types.js";

export interface MigrateCommandOptions {
  cwd?: string;
  patterns: string[];
  out?: string;
  strict?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

function toMigrationError(resource: ResourceFile, error: unknown): MigrationError {
  const message = (error as Error).message || String(error);
  return {
    filePath: resource.filePath,
    resourceName: resource.name,
    resourceKind: resource.kind,
    message,
  };
}

function sortResourcesForOutput(resources: ParsedResource[]): ParsedResource[] {
  const order: Record<ParsedResource["kind"], number> = {
    connection: 0,
    datasource: 1,
    pipe: 2,
  };
  return [...resources].sort((a, b) => {
    const byType = order[a.kind] - order[b.kind];
    if (byType !== 0) {
      return byType;
    }
    return a.name.localeCompare(b.name);
  });
}

export async function runMigrate(
  options: MigrateCommandOptions
): Promise<MigrationResult> {
  const cwd = options.cwd ?? process.cwd();
  const strict = options.strict ?? true;
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const outputPath = path.isAbsolute(options.out ?? "")
    ? (options.out as string)
    : path.resolve(cwd, options.out ?? "tinybird.migration.ts");

  const errors: MigrationError[] = [];

  if (!options.patterns || options.patterns.length === 0) {
    return {
      success: false,
      outputPath,
      migrated: [],
      errors: [
        {
          filePath: ".",
          resourceName: "patterns",
          resourceKind: "datasource",
          message: "At least one file, directory, or glob pattern is required.",
        },
      ],
      dryRun,
    };
  }

  const discovered = discoverResourceFiles(options.patterns, cwd);
  errors.push(...discovered.errors);

  const parsedResources: ParsedResource[] = [];
  for (const resource of discovered.resources) {
    try {
      parsedResources.push(parseResourceFile(resource));
    } catch (error) {
      if (error instanceof MigrationParseError) {
        errors.push({
          filePath: error.filePath,
          resourceName: error.resourceName,
          resourceKind: error.resourceKind,
          message: error.message,
        });
      } else {
        errors.push(toMigrationError(resource, error));
      }
    }
  }

  const parsedConnections = parsedResources.filter(
    (resource): resource is Extract<ParsedResource, { kind: "connection" }> =>
      resource.kind === "connection"
  );
  const parsedDatasources = parsedResources.filter(
    (resource): resource is Extract<ParsedResource, { kind: "datasource" }> =>
      resource.kind === "datasource"
  );
  const parsedPipes = parsedResources.filter(
    (resource): resource is Extract<ParsedResource, { kind: "pipe" }> =>
      resource.kind === "pipe"
  );

  const migrated: ParsedResource[] = [];
  const migratedConnectionNames = new Set<string>();
  const migratedDatasourceNames = new Set<string>();
  const parsedConnectionTypeByName = new Map(
    parsedConnections.map((connection) => [connection.name, connection.connectionType] as const)
  );

  for (const connection of parsedConnections) {
    try {
      validateResourceForEmission(connection);
      migrated.push(connection);
      migratedConnectionNames.add(connection.name);
    } catch (error) {
      errors.push({
        filePath: connection.filePath,
        resourceName: connection.name,
        resourceKind: connection.kind,
        message: (error as Error).message,
      });
    }
  }

  for (const datasource of parsedDatasources) {
    const referencedConnectionName =
      datasource.kafka?.connectionName ??
      datasource.s3?.connectionName ??
      datasource.gcs?.connectionName ??
      datasource.dynamodb?.connectionName;

    if (
      referencedConnectionName &&
      !migratedConnectionNames.has(referencedConnectionName)
    ) {
      errors.push({
        filePath: datasource.filePath,
        resourceName: datasource.name,
        resourceKind: datasource.kind,
        message: `Datasource references missing/unmigrated connection "${referencedConnectionName}".`,
      });
      continue;
    }

    if (datasource.kafka) {
      const kafkaConnectionType = parsedConnectionTypeByName.get(datasource.kafka.connectionName);
      if (kafkaConnectionType !== "kafka") {
        errors.push({
          filePath: datasource.filePath,
          resourceName: datasource.name,
          resourceKind: datasource.kind,
          message: `Datasource kafka ingestion requires a kafka connection, found "${kafkaConnectionType ?? "(none)"}".`,
        });
        continue;
      }
    }

    const importConfig = datasource.s3 ?? datasource.gcs;
    if (importConfig) {
      const importConnectionType = parsedConnectionTypeByName.get(importConfig.connectionName);
      if (importConnectionType !== "s3" && importConnectionType !== "gcs") {
        errors.push({
          filePath: datasource.filePath,
          resourceName: datasource.name,
          resourceKind: datasource.kind,
          message:
            `Datasource import directives require an s3 or gcs connection, found "${importConnectionType ?? "(none)"}".`,
        });
        continue;
      }

      if (importConnectionType === "gcs") {
        datasource.gcs = { ...importConfig };
        datasource.s3 = undefined;
      } else {
        datasource.s3 = { ...importConfig };
        datasource.gcs = undefined;
      }
    }

    if (datasource.dynamodb) {
      const dynamodbConnectionType = parsedConnectionTypeByName.get(
        datasource.dynamodb.connectionName
      );
      if (dynamodbConnectionType !== "dynamodb") {
        errors.push({
          filePath: datasource.filePath,
          resourceName: datasource.name,
          resourceKind: datasource.kind,
          message: `Datasource DynamoDB ingestion requires a dynamodb connection, found "${dynamodbConnectionType ?? "(none)"}".`,
        });
        continue;
      }
    }

    try {
      validateResourceForEmission(datasource);
      migrated.push(datasource);
      migratedDatasourceNames.add(datasource.name);
    } catch (error) {
      errors.push({
        filePath: datasource.filePath,
        resourceName: datasource.name,
        resourceKind: datasource.kind,
        message: (error as Error).message,
      });
    }
  }

  for (const pipe of parsedPipes) {
    if (pipe.type === "sink") {
      const sinkConnectionName = pipe.sink?.connectionName;
      if (!sinkConnectionName || !migratedConnectionNames.has(sinkConnectionName)) {
        errors.push({
          filePath: pipe.filePath,
          resourceName: pipe.name,
          resourceKind: pipe.kind,
          message: `Sink pipe references missing/unmigrated connection "${sinkConnectionName ?? "(none)"}".`,
        });
        continue;
      }
      const sinkConnectionType = parsedConnectionTypeByName.get(sinkConnectionName);
      if (!sinkConnectionType) {
        errors.push({
          filePath: pipe.filePath,
          resourceName: pipe.name,
          resourceKind: pipe.kind,
          message: `Sink pipe connection "${sinkConnectionName}" could not be resolved.`,
        });
        continue;
      }
      if (sinkConnectionType !== pipe.sink?.service) {
        errors.push({
          filePath: pipe.filePath,
          resourceName: pipe.name,
          resourceKind: pipe.kind,
          message: `Sink pipe service "${pipe.sink?.service}" is incompatible with connection "${sinkConnectionName}" type "${sinkConnectionType}".`,
        });
        continue;
      }
    }

    if (
      pipe.type === "materialized" &&
      (!pipe.materializedDatasource ||
        !migratedDatasourceNames.has(pipe.materializedDatasource))
    ) {
      errors.push({
        filePath: pipe.filePath,
        resourceName: pipe.name,
        resourceKind: pipe.kind,
        message: `Materialized pipe references missing/unmigrated datasource "${pipe.materializedDatasource ?? "(none)"}".`,
      });
      continue;
    }

    if (
      pipe.type === "copy" &&
      (!pipe.copyTargetDatasource ||
        !migratedDatasourceNames.has(pipe.copyTargetDatasource))
    ) {
      errors.push({
        filePath: pipe.filePath,
        resourceName: pipe.name,
        resourceKind: pipe.kind,
        message: `Copy pipe references missing/unmigrated datasource "${pipe.copyTargetDatasource ?? "(none)"}".`,
      });
      continue;
    }

    try {
      validateResourceForEmission(pipe);
      migrated.push(pipe);
    } catch (error) {
      errors.push({
        filePath: pipe.filePath,
        resourceName: pipe.name,
        resourceKind: pipe.kind,
        message: (error as Error).message,
      });
    }
  }

  const sortedMigrated = sortResourcesForOutput(migrated);
  let outputContent: string | undefined;

  if (sortedMigrated.length > 0) {
    try {
      outputContent = emitMigrationFileContent(sortedMigrated);
    } catch (error) {
      errors.push({
        filePath: ".",
        resourceName: "output",
        resourceKind: "datasource",
        message: `Failed to emit migration output: ${(error as Error).message}`,
      });
    }
  }

  if (!dryRun && outputContent) {
    if (fs.existsSync(outputPath) && !force) {
      errors.push({
        filePath: path.relative(cwd, outputPath),
        resourceName: path.basename(outputPath),
        resourceKind: "datasource",
        message: `Output file already exists: ${outputPath}. Use --force to overwrite.`,
      });
    } else {
      fs.writeFileSync(outputPath, outputContent);
    }
  }

  const success = strict ? errors.length === 0 : true;
  return {
    success,
    outputPath,
    migrated: sortedMigrated,
    errors,
    dryRun,
    outputContent,
  };
}
