# @tinybirdco/sdk

> **Note:** This package is experimental. APIs may change between versions.

A TypeScript SDK for defining Tinybird resources with full type inference. Define your datasources, pipes, and queries in TypeScript and sync them directly to Tinybird.

## Installation

```bash
npm install @tinybirdco/sdk
```

## Requirements

TypeScript `>=4.9` is supported for consumers.

Officially supported runtime:
- Node.js 20 LTS or later non-EOL versions

Not officially supported (untested in this repository at this time):
- Deno `>=1.28.0`
- Bun `>=1.0.0`
- Cloudflare Workers
- Vercel Edge Runtime
- Jest `>=28` (including `"node"` environment)
- Nitro `>=2.6.0`

Web browsers are not supported. This SDK is designed for server-side usage and using it directly in the browser may expose Tinybird API credentials.

If you need support for other runtimes, please open or upvote an issue on GitHub.

## Quick Start

### 1. Initialize your project

```bash
npx tinybird init
```

This creates:
- `tinybird.config.json` - Configuration file
- `src/tinybird/datasources.ts` - Define your datasources
- `src/tinybird/pipes.ts` - Define your pipes/endpoints
- `src/tinybird/client.ts` - Your typed Tinybird client

### 2. Configure your token

Create a `.env.local` file:

```env
TINYBIRD_TOKEN=p.your_token_here
```

### 3. Define your datasources

```typescript
// src/tinybird/datasources.ts
import { defineDatasource, t, engine, type InferRow } from "@tinybirdco/sdk";

export const pageViews = defineDatasource("page_views", {
  description: "Page view tracking data",
  schema: {
    timestamp: t.dateTime(),
    pathname: t.string(),
    session_id: t.string(),
    country: t.string().lowCardinality().nullable(),
  },
  engine: engine.mergeTree({
    sortingKey: ["pathname", "timestamp"],
  }),
});

// Export row type for ingestion
export type PageViewsRow = InferRow<typeof pageViews>;
```

### 4. Define your endpoints

```typescript
// src/tinybird/pipes.ts
import { defineEndpoint, node, t, p, type InferParams, type InferOutputRow } from "@tinybirdco/sdk";

export const topPages = defineEndpoint("top_pages", {
  description: "Get the most visited pages",
  params: {
    start_date: p.dateTime(),
    end_date: p.dateTime(),
    limit: p.int32().optional(10),
  },
  nodes: [
    node({
      name: "aggregated",
      sql: `
        SELECT pathname, count() AS views
        FROM page_views
        WHERE timestamp >= {{DateTime(start_date)}}
          AND timestamp <= {{DateTime(end_date)}}
        GROUP BY pathname
        ORDER BY views DESC
        LIMIT {{Int32(limit, 10)}}
      `,
    }),
  ],
  output: {
    pathname: t.string(),
    views: t.uint64(),
  },
});

// Export endpoint types
export type TopPagesParams = InferParams<typeof topPages>;
export type TopPagesOutput = InferOutputRow<typeof topPages>;
```

### 5. Create your client

```typescript
// src/tinybird/client.ts
import { Tinybird } from "@tinybirdco/sdk";
import { pageViews, type PageViewsRow } from "./datasources";
import { topPages, type TopPagesParams, type TopPagesOutput } from "./pipes";

export const tinybird = new Tinybird({
  datasources: { pageViews },
  pipes: { topPages },
});

// Optional: customize fetch for framework-specific cache or runtime behavior
export const tinybirdNoStore = new Tinybird({
  datasources: { pageViews },
  pipes: { topPages },
  fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }),
});

// Re-export types for convenience
export type { PageViewsRow, TopPagesParams, TopPagesOutput };
export { pageViews, topPages };
```

### 6. Add path alias (for Next.js/TypeScript projects)

Add to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@tinybird/client": ["./src/tinybird/client.ts"]
    }
  }
}
```

### 7. Start development

```bash
npx tinybird dev
```

This watches your schema files and automatically syncs changes to Tinybird.

### 8. Use the typed client

```typescript
import { tinybird, type PageViewsRow } from "@tinybird/client";

// Type-safe data ingestion
await tinybird.pageViews.ingest({
  timestamp: "2024-01-15 10:30:00",
  pathname: "/home",
  session_id: "abc123",
  country: "US",
});

// Type-safe queries with autocomplete
const result = await tinybird.topPages.query({
  start_date: "2024-01-01 00:00:00",
  end_date: "2024-01-31 23:59:59",
  limit: 5,
});

// result.data is fully typed: { pathname: string, views: bigint }[]
```

### 9. Manage datasource rows

```typescript
import { tinybird } from "@tinybird/client";

// Datasource accessors support: ingest, append, replace, delete, truncate

// Ingest one row as JSON
await tinybird.pageViews.ingest({
  timestamp: "2024-01-15 10:30:00",
  pathname: "/pricing",
  session_id: "session_123",
  country: "US",
});

// Import rows from a remote file
await tinybird.pageViews.append({
  url: "https://example.com/page_views.csv",
});

// Replace all rows from a remote file
await tinybird.pageViews.replace({
  url: "https://example.com/page_views_full_snapshot.csv",
});

// Delete matching rows
await tinybird.pageViews.delete({
  deleteCondition: "country = 'XX'",
});

// Preview matching rows without deleting
await tinybird.pageViews.delete({
  deleteCondition: "country = 'XX'",
  dryRun: true,
});

// Remove all rows from the datasource
await tinybird.pageViews.truncate();
```

## Public Tinybird API (Optional)

If you want a low-level API wrapper that is decoupled from the typed client layer,
you can use `createTinybirdApi()` directly with just `baseUrl` and `token`:

```typescript
import { createTinybirdApi } from "@tinybirdco/sdk";

const api = createTinybirdApi({
  baseUrl: "https://api.tinybird.co",
  token: process.env.TINYBIRD_TOKEN!,
});

// Query endpoint pipe (with optional type parameters)
interface TopPagesRow { pathname: string; visits: number }
interface TopPagesParams { start_date: string; end_date: string; limit?: number }

const topPages = await api.query<TopPagesRow, TopPagesParams>("top_pages", {
  start_date: "2024-01-01",
  end_date: "2024-01-31",
  limit: 5,
});

// Ingest one row into datasource (with optional type parameter)
interface EventRow { timestamp: string; event_name: string; pathname: string }

await api.ingest<EventRow>("events", {
  timestamp: "2024-01-15 10:30:00",
  event_name: "page_view",
  pathname: "/home",
});

// Ingest retry behavior (disabled by default):
// - 429 retries use Retry-After / X-RateLimit-Reset headers.
// - 503 retries use SDK default exponential backoff.
await api.ingest<EventRow>(
  "events",
  {
    timestamp: "2024-01-15 10:31:00",
    event_name: "button_click",
    pathname: "/pricing",
  },
  {
    maxRetries: 3,
  }
);

// Import rows from URL/file
await api.appendDatasource("events", {
  url: "https://example.com/events.csv",
});

// Delete rows matching a SQL condition
await api.deleteDatasource("events", {
  deleteCondition: "event_name = 'test'",
});

// Delete dry run (validate and return count only)
await api.deleteDatasource("events", {
  deleteCondition: "event_name = 'test'",
  dryRun: true,
});

// Truncate datasource
await api.truncateDatasource("events");

// Execute raw SQL (with optional type parameter)
interface CountResult { total: number }

const sqlResult = await api.sql<CountResult>("SELECT count() AS total FROM events");

// Optional per-request token override
await api.request("/v1/workspace", {
  token: process.env.TINYBIRD_BRANCH_TOKEN,
});
```

This Tinybird API is standalone and can be used without `createClient()` or `new Tinybird()`.
It is intended for cases where you want a simple public API that remains
decoupled from the higher-level typed client APIs.

## JWT Token Creation

Create short-lived JWT tokens for secure, scoped access to your Tinybird resources. This is useful for:
- Frontend applications that need to call Tinybird APIs directly from browsers
- Multi-tenant applications requiring row-level security
- Time-limited access with automatic expiration

```typescript
import { createClient } from "@tinybirdco/sdk";

const client = createClient({
  baseUrl: "https://api.tinybird.co",
  token: process.env.TINYBIRD_ADMIN_TOKEN!, // Requires ADMIN scope
});

// Create a JWT token with scoped access
const { token } = await client.tokens.createJWT({
  name: "user_123_session",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
  scopes: [
    {
      type: "PIPES:READ",
      resource: "user_dashboard",
      fixed_params: { user_id: 123 }, // Row-level security
    },
  ],
  limits: { rps: 10 }, // Optional rate limiting
});

// Use the JWT token for client-side queries
const userClient = createClient({
  baseUrl: "https://api.tinybird.co",
  token, // The JWT
});
```

### Scope Types

| Scope | Description |
|-------|-------------|
| `PIPES:READ` | Read access to a specific pipe endpoint |
| `DATASOURCES:READ` | Read access to a datasource (with optional `filter`) |
| `DATASOURCES:APPEND` | Append access to a datasource |

### Scope Options

- **`fixed_params`**: For pipes, embed parameters that cannot be overridden by the caller
- **`filter`**: For datasources, append a SQL WHERE clause (e.g., `"org_id = 'acme'"`)

## CLI Commands

### `npx tinybird init`

Initialize a new Tinybird TypeScript project. The setup flow can also install Tinybird agent skills and Tinybird SQL syntax highlighting for Cursor/VS Code (when available). If you have existing `.datasource` and `.pipe` files in your repository, the CLI will detect them and ask if you want to include them in your configuration.

```bash
npx tinybird init
npx tinybird init --force       # Overwrite existing files
npx tinybird init --skip-login  # Skip browser login flow
```

This enables incremental migration for existing Tinybird projects - you can keep your `.datasource` and `.pipe` files alongside TypeScript definitions.

### `tinybird migrate`

Migrate local Tinybird datafiles (`.datasource`, `.pipe`, `.connection`) into a single TypeScript definitions file.

```bash
tinybird migrate "tinybird/**/*.datasource" "tinybird/**/*.pipe" "tinybird/**/*.connection"
tinybird migrate tinybird/legacy --out ./tinybird.migration.ts
tinybird migrate tinybird --dry-run
```

Behavior:
- Processes files, directories, and glob patterns.
- Continues through all matches and reports migratable resources plus per-file errors.
- In strict mode (default), exits with non-zero status if any errors are found.
- Infers parameter defaults from scalar SQL placeholders (for example `{{String(env, 'prod')}}`) while treating `{{Array(ids, 'String')}}` second arguments as element types, not defaults.
- Writes one output file by default: `./tinybird.migration.ts`.

### `tinybird dev`

Watch for changes and sync with Tinybird automatically. Only works on feature branches (not main).

```bash
tinybird dev
tinybird dev --local   # Sync with local Tinybird container
tinybird dev --branch  # Explicitly use Tinybird cloud with branches
```

**Note:** `dev` mode is blocked on the main branch to prevent accidental production deployments. Use `tinybird deploy` for production, or switch to a feature branch.

### `tinybird build`

Build and push resources to a Tinybird branch (not main).

```bash
tinybird build
tinybird build --dry-run  # Preview without pushing
tinybird build --local    # Build to local Tinybird container
tinybird build --branch   # Explicitly use Tinybird cloud with branches
```

**Note:** `build` is blocked on the main branch. Use `tinybird deploy` for production deployments.

### `tinybird deploy`

Deploy resources to the main Tinybird workspace (production). This is the only way to deploy to main.

```bash
tinybird deploy
tinybird deploy --dry-run  # Preview without pushing
tinybird deploy --check    # Validate with the API without applying changes
tinybird deploy --allow-destructive-operations  # Allow deletes in main deploy
```

Use `--allow-destructive-operations` only when your deploy intentionally removes
existing datasources, pipes, or connections from the main workspace.

### `tinybird pull`

Download all cloud resources as native Tinybird datafiles (`.datasource`, `.pipe`, `.connection`).

```bash
tinybird pull
tinybird pull --output-dir ./tinybird-datafiles
tinybird pull --force  # Overwrite existing files
```

### `tinybird login`

Authenticate with Tinybird via browser. Use this to set up credentials for an existing project without reinitializing.

```bash
tinybird login
```

This is useful when:
- You cloned an existing project that has a `tinybird.config.json` but no credentials
- Your token has expired or needs to be refreshed
- You're switching to a different Tinybird workspace

The command saves your token to `.env.local` and updates the `baseUrl` in your config file if you select a different region.

### `tinybird branch`

Manage Tinybird branches.

```bash
tinybird branch list      # List all branches
tinybird branch status    # Show current branch status
tinybird branch delete <name>  # Delete a branch
```

### `tinybird info`

Display information about the current project and workspace.

```bash
tinybird info         # Show workspace, local, and project info
tinybird info --json  # Output as JSON
```

Shows:
- **Workspace**: Cloud workspace details (name, ID, user, API host, dashboard URL, token)
- **Local**: Local Tinybird container info (when `devMode` is `local`)
- **Branch**: Current branch details (when `devMode` is `branch` and on a feature branch)
- **Project**: Configuration and git information

## Configuration

Create a `tinybird.config.json` (or `tinybird.config.mjs` / `tinybird.config.cjs` for dynamic logic) in your project root:

```json
{
  "include": [
    "src/tinybird/datasources.ts",
    "src/tinybird/pipes.ts",
    "src/tinybird/legacy.datasource",
    "src/tinybird/legacy.pipe"
  ],
  "token": "${TINYBIRD_TOKEN}",
  "baseUrl": "https://api.tinybird.co",
  "devMode": "branch"
}
```

You can mix TypeScript files with raw `.datasource` and `.pipe` files for incremental migration.
`include` also supports glob patterns like `src/tinybird/**/*.ts` and `src/tinybird/**/*.datasource`.

### Config File Formats

The SDK supports multiple config file formats (in priority order):

| File | Description |
|------|-------------|
| `tinybird.config.mjs` | ESM JavaScript config with dynamic logic |
| `tinybird.config.cjs` | CommonJS JavaScript config with dynamic logic |
| `tinybird.config.json` | Standard JSON config (default for new projects) |
| `tinybird.json` | Legacy JSON config (backward compatible) |

For JavaScript configs, export a default config object or function:

```javascript
// tinybird.config.mjs
/** @type {import("@tinybirdco/sdk").TinybirdConfig} */
export default {
  include: ["src/lib/tinybird.ts"],
  token: process.env.TINYBIRD_TOKEN,
  baseUrl: "https://api.tinybird.co",
  devMode: "branch",
};
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `include` | `string[]` | *required* | Array of file paths or glob patterns for TypeScript files and raw `.datasource`/`.pipe` files |
| `token` | `string` | *required* | API token. Supports `${ENV_VAR}` interpolation for environment variables |
| `baseUrl` | `string` | `"https://api.tinybird.co"` | Tinybird API URL. Use `"https://api.us-east.tinybird.co"` for US region |
| `devMode` | `"branch"` \| `"local"` | `"branch"` | Development mode. `"branch"` uses Tinybird cloud with branches, `"local"` uses local Docker container |

### Local Development Mode

Use a local Tinybird container for development without affecting your cloud workspace:

1. Start the local container:
   ```bash
   docker run -d -p 7181:7181 --name tinybird-local tinybirdco/tinybird-local:latest
   ```

2. Configure your project:
   ```json
   {
     "devMode": "local"
   }
   ```

   Or use the CLI flag:
   ```bash
   npx tinybird dev --local
   ```

In local mode:
- Tokens are automatically obtained from the local container
- A workspace is created per git branch
- No cloud authentication required

## Defining Resources

### Connections

```typescript
import { defineKafkaConnection, defineS3Connection, defineGCSConnection, defineDynamoDBConnection, secret } from "@tinybirdco/sdk";

export const eventsKafka = defineKafkaConnection("events_kafka", {
  bootstrapServers: "kafka.example.com:9092",
  securityProtocol: "SASL_SSL",
  saslMechanism: "PLAIN",
  key: secret("KAFKA_KEY"),
  secret: secret("KAFKA_SECRET"),
});

export const landingS3 = defineS3Connection("landing_s3", {
  region: "us-east-1",
  arn: "arn:aws:iam::123456789012:role/tinybird-s3-access",
});

export const landingGCS = defineGCSConnection("landing_gcs", {
  serviceAccountCredentialsJson: secret("GCS_SERVICE_ACCOUNT_CREDENTIALS_JSON"),
});

export const eventsDynamo = defineDynamoDBConnection("events_dynamo", {
  region: "us-east-1",
  arn: secret("DYNAMODB_ROLE_ARN"),
});
```

Use connections from datasources:

```typescript
import { defineDatasource, t, engine } from "@tinybirdco/sdk";
import { eventsKafka, landingS3, landingGCS, eventsDynamo } from "./connections";

export const kafkaEvents = defineDatasource("kafka_events", {
  schema: {
    timestamp: t.dateTime(),
    payload: t.string(),
  },
  engine: engine.mergeTree({ sortingKey: ["timestamp"] }),
  kafka: {
    connection: eventsKafka,
    topic: "events",
    groupId: "events-consumer",
    autoOffsetReset: "earliest",
  },
});

export const s3Landing = defineDatasource("s3_landing", {
  schema: {
    timestamp: t.dateTime(),
    session_id: t.string(),
  },
  engine: engine.mergeTree({ sortingKey: ["timestamp"] }),
  s3: {
    connection: landingS3,
    bucketUri: "s3://my-bucket/events/*.csv",
    schedule: "@auto",
  },
});

export const gcsLanding = defineDatasource("gcs_landing", {
  schema: {
    timestamp: t.dateTime(),
    session_id: t.string(),
  },
  engine: engine.mergeTree({ sortingKey: ["timestamp"] }),
  gcs: {
    connection: landingGCS,
    bucketUri: "gs://my-gcs-bucket/events/*.csv",
    schedule: "@auto",
  },
});

export const dynamoEvents = defineDatasource("dynamo_events", {
  schema: {
    id: t.string().jsonPath("$.Id"),
    _record: t.string().jsonPath("$.NewImage"),
    _timestamp: t.dateTime64(3).jsonPath("$.ApproximateCreationDateTime"),
    _event_name: t.string().lowCardinality().jsonPath("$.eventName"),
    _is_deleted: t.uint8().jsonPath("$._is_deleted"),
  },
  engine: engine.replacingMergeTree({
    sortingKey: ["id"],
    ver: "_timestamp",
    isDeleted: "_is_deleted",
  }),
  dynamodb: {
    connection: eventsDynamo,
    tableArn: "arn:aws:dynamodb:us-east-1:123456789012:table/events",
    exportBucket: "s3://my-export-bucket",
  },
});
```

### Datasources

```typescript
import { defineDatasource, t, engine, type InferRow } from "@tinybirdco/sdk";

export const events = defineDatasource("events", {
  description: "Event tracking data",
  schema: {
    timestamp: t.dateTime(),
    event_name: t.string().lowCardinality(),
    user_id: t.string().nullable(),
    properties: t.string(), // JSON as string
  },
  engine: engine.mergeTree({
    sortingKey: ["event_name", "timestamp"],
    partitionKey: "toYYYYMM(timestamp)",
    ttl: "timestamp + INTERVAL 90 DAY",
  }),
});

export type EventsRow = InferRow<typeof events>;
```

### Endpoints (API pipes)

```typescript
import { defineEndpoint, node, t, p, type InferParams, type InferOutputRow } from "@tinybirdco/sdk";

export const topEvents = defineEndpoint("top_events", {
  description: "Get the most frequent events",
  params: {
    start_date: p.dateTime(),
    end_date: p.dateTime(),
    limit: p.int32().optional(10),
  },
  nodes: [
    node({
      name: "aggregated",
      sql: `
        SELECT event_name, count() AS event_count
        FROM events
        WHERE timestamp >= {{DateTime(start_date)}}
          AND timestamp <= {{DateTime(end_date)}}
        GROUP BY event_name
        ORDER BY event_count DESC
        LIMIT {{Int32(limit, 10)}}
      `,
    }),
  ],
  output: {
    event_name: t.string(),
    event_count: t.uint64(),
    debug_info: t.string().optional(), // May be absent from some responses
  },
});

export type TopEventsParams = InferParams<typeof topEvents>;
export type TopEventsOutput = InferOutputRow<typeof topEvents>;
// { event_name: string; event_count: number; debug_info?: string }
```

### Internal Pipes (not exposed as API)

```typescript
import { definePipe, node } from "@tinybirdco/sdk";

export const filteredEvents = definePipe("filtered_events", {
  description: "Filter events by date range",
  params: {
    start_date: p.dateTime(),
    end_date: p.dateTime(),
  },
  nodes: [
    node({
      name: "filtered",
      sql: `
        SELECT * FROM events
        WHERE timestamp >= {{DateTime(start_date)}}
          AND timestamp <= {{DateTime(end_date)}}
      `,
    }),
  ],
});
```

### Materialized Views

```typescript
import { defineDatasource, defineMaterializedView, t, engine } from "@tinybirdco/sdk";

// Target datasource for the materialized view
export const dailyStats = defineDatasource("daily_stats", {
  description: "Daily aggregated statistics",
  schema: {
    date: t.date(),
    pathname: t.string(),
    views: t.simpleAggregateFunction("sum", t.uint64()),
    unique_sessions: t.aggregateFunction("uniq", t.string()),
  },
  engine: engine.aggregatingMergeTree({
    sortingKey: ["date", "pathname"],
  }),
});

// Materialized view that populates the datasource
export const dailyStatsMv = defineMaterializedView("daily_stats_mv", {
  description: "Materialize daily page view aggregations",
  datasource: dailyStats,
  nodes: [
    node({
      name: "aggregate",
      sql: `
        SELECT
          toDate(timestamp) AS date,
          pathname,
          count() AS views,
          uniqState(session_id) AS unique_sessions
        FROM page_views
        GROUP BY date, pathname
      `,
    }),
  ],
});
```

### Copy Pipes

```typescript
import { defineCopyPipe, node } from "@tinybirdco/sdk";

// Scheduled copy pipe
export const dailySnapshot = defineCopyPipe("daily_snapshot", {
  description: "Daily snapshot of statistics",
  datasource: snapshotDatasource,
  schedule: "0 0 * * *", // Run daily at midnight
  mode: "append",
  nodes: [
    node({
      name: "snapshot",
      sql: `
        SELECT today() AS snapshot_date, pathname, count() AS views
        FROM page_views
        WHERE toDate(timestamp) = today() - 1
        GROUP BY pathname
      `,
    }),
  ],
});

// On-demand copy pipe
export const manualReport = defineCopyPipe("manual_report", {
  description: "On-demand report generation",
  datasource: reportDatasource,
  schedule: "@on-demand",
  mode: "replace",
  nodes: [
    node({
      name: "report",
      sql: `SELECT * FROM events WHERE timestamp >= now() - interval 7 day`,
    }),
  ],
});
```

### Sink Pipes

Use sink pipes to publish query results to external systems. The SDK supports only Kafka and S3 sinks.

```typescript
import { defineSinkPipe, node } from "@tinybirdco/sdk";
import { eventsKafka, landingS3 } from "./connections";

// Kafka sink
export const kafkaEventsSink = defineSinkPipe("kafka_events_sink", {
  sink: {
    connection: eventsKafka,
    topic: "events_export",
    schedule: "@on-demand",
  },
  nodes: [
    node({
      name: "publish",
      sql: `
        SELECT timestamp, payload
        FROM kafka_events
      `,
    }),
  ],
});

// S3 sink
export const s3EventsSink = defineSinkPipe("s3_events_sink", {
  sink: {
    connection: landingS3,
    bucketUri: "s3://my-bucket/exports/",
    fileTemplate: "events_{date}",
    format: "csv",
    schedule: "@once",
    strategy: "create_new",
    compression: "gzip",
  },
  nodes: [
    node({
      name: "export",
      sql: `
        SELECT timestamp, session_id
        FROM s3_landing
      `,
    }),
  ],
});
```

### Static Tokens

Define reusable tokens for resource access control:

```typescript
import { defineToken, defineDatasource, defineEndpoint, t, node } from "@tinybirdco/sdk";

// Define a token once
const appToken = defineToken("app_read");
const ingestToken = defineToken("ingest_token");

// Use in datasources with READ or APPEND scope
export const events = defineDatasource("events", {
  schema: {
    timestamp: t.dateTime(),
    event_name: t.string(),
  },
  tokens: [
    { token: appToken, scope: "READ" },
    { token: ingestToken, scope: "APPEND" },
  ],
});

// Use in endpoints with READ scope
export const topEvents = defineEndpoint("top_events", {
  nodes: [node({ name: "endpoint", sql: "SELECT * FROM events LIMIT 10" })],
  output: { timestamp: t.dateTime(), event_name: t.string() },
  tokens: [{ token: appToken, scope: "READ" }],
});
```

TypeScript provides autocomplete for the correct scopes:
- **Datasources**: `READ` (query access) or `APPEND` (ingest access)
- **Pipes**: `READ` only

## Type Validators

Use `t.*` to define column types with full TypeScript inference:

```typescript
import { t } from "@tinybirdco/sdk";

const schema = {
  // Strings
  name: t.string(),
  id: t.uuid(),
  code: t.fixedString(3),

  // Numbers
  count: t.int32(),
  amount: t.float64(),
  big_number: t.uint64(),
  price: t.decimal(10, 2),

  // Date/Time
  created_at: t.dateTime(),
  updated_at: t.dateTime64(3),
  birth_date: t.date(),

  // Boolean
  is_active: t.bool(),

  // Complex types
  tags: t.array(t.string()),
  metadata: t.map(t.string(), t.string()),

  // Aggregate functions (for materialized views)
  total: t.simpleAggregateFunction("sum", t.uint64()),
  unique_users: t.aggregateFunction("uniq", t.string()),

  // Modifiers
  nullable_field: t.string().nullable(),
  optional_output_field: t.string().optional(), // For endpoint output schemas
  category: t.string().lowCardinality(),
  status: t.string().default("pending"),
  event_id: t.uuid().defaultExpr("generateUUIDv4()"),
};
```

## Parameter Validators

Use `p.*` to define pipe query parameters:

```typescript
import { p } from "@tinybirdco/sdk";

const params = {
  // Required parameters
  start_date: p.dateTime(),
  user_id: p.string(),

  // Optional with defaults
  limit: p.int32().optional(10),
  offset: p.int32().optional(0),

  // With descriptions (for documentation)
  status: p.string().optional("active").describe("Filter by status"),
};
```

## Engine Configurations

```typescript
import { engine } from "@tinybirdco/sdk";

// MergeTree (default)
engine.mergeTree({
  sortingKey: ["user_id", "timestamp"],
  partitionKey: "toYYYYMM(timestamp)",
  ttl: "timestamp + INTERVAL 90 DAY",
});

// ReplacingMergeTree (for upserts)
engine.replacingMergeTree({
  sortingKey: ["id"],
  version: "updated_at",
});

// SummingMergeTree (for pre-aggregation)
engine.summingMergeTree({
  sortingKey: ["date", "category"],
  columns: ["count", "total"],
});

// AggregatingMergeTree (for complex aggregates)
engine.aggregatingMergeTree({
  sortingKey: ["date"],
});

// Null (for materialized view source tables that discard raw input)
engine.null();
```

## Next.js Integration

For Next.js projects, add these scripts to your `package.json`:

```json
{
  "scripts": {
    "dev": "concurrently -n next,tinybird \"next dev\" \"tinybird dev\"",
    "tinybird:build": "tinybird build"
  },
  "devDependencies": {
    "concurrently": "^9.0.0"
  }
}
```

The CLI automatically loads `.env.local` and `.env` files, so no additional setup is needed.

Add the path alias to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@tinybird/client": ["./src/tinybird/client.ts"]
    }
  }
}
```

Now `npm run dev` starts both Next.js and Tinybird sync together.

## Type Inference

The SDK provides full type inference for your schemas:

```typescript
import { type InferRow, type InferParams, type InferOutputRow } from "@tinybirdco/sdk";
import { pageViews, topPages } from "./tinybird/datasources";

// Infer the row type for a datasource
type PageViewRow = InferRow<typeof pageViews>;
// { timestamp: string, pathname: string, session_id: string, country: string | null }

// Infer the parameters for a pipe
type TopPagesParams = InferParams<typeof topPages>;
// { start_date: string, end_date: string, limit?: number }

// Infer the output type for a pipe
type TopPagesOutput = InferOutputRow<typeof topPages>;
// { pathname: string, views: bigint }
```

## License

MIT
