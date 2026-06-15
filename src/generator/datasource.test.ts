import { describe, it, expect } from 'vitest';
import { generateDatasource, generateAllDatasources } from './datasource.js';
import { defineDatasource } from '../schema/datasource.js';
import { defineKafkaConnection, defineS3Connection, defineGCSConnection, defineDynamoDBConnection } from '../schema/connection.js';
import { defineToken } from '../schema/token.js';
import { t } from '../schema/types.js';
import { engine } from '../schema/engines.js';

describe('Datasource Generator', () => {
  describe('generateDatasource', () => {
    it('generates basic datasource with schema', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          id: t.string(),
          count: t.int32(),
        },
      });

      const result = generateDatasource(ds);
      expect(result.name).toBe('test_ds');
      expect(result.content).toContain('SCHEMA >');
      expect(result.content).toContain('id String');
      expect(result.content).toContain('count Int32');
    });

    it('includes description when provided', () => {
      const ds = defineDatasource('test_ds', {
        description: 'Test datasource description',
        schema: {
          id: t.string(),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('DESCRIPTION >');
      expect(result.content).toContain('Test datasource description');
    });

    it('includes engine configuration', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          id: t.string(),
        },
        engine: engine.mergeTree({
          sortingKey: ['id'],
        }),
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('ENGINE "MergeTree"');
      expect(result.content).toContain('ENGINE_SORTING_KEY "id"');
    });

    it('includes Null engine configuration without sorting key', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          id: t.string(),
        },
        engine: engine.null(),
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('ENGINE Null');
      expect(result.content).not.toContain('ENGINE_SORTING_KEY');
    });

    it('includes partition key in engine config', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          id: t.string(),
          timestamp: t.dateTime(),
        },
        engine: engine.mergeTree({
          sortingKey: ['id'],
          partitionKey: 'toYYYYMM(timestamp)',
        }),
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('ENGINE_PARTITION_KEY "toYYYYMM(timestamp)"');
    });

    it('includes TTL in engine config', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          id: t.string(),
          timestamp: t.dateTime(),
        },
        engine: engine.mergeTree({
          sortingKey: ['id'],
          ttl: 'timestamp + INTERVAL 90 DAY',
        }),
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('ENGINE_TTL "timestamp + INTERVAL 90 DAY"');
    });

    it('includes forward query when provided', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          id: t.string(),
        },
        forwardQuery: 'SELECT id',
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('FORWARD_QUERY >');
      expect(result.content).toContain('    SELECT id');
    });

    it('includes backfill skip when provided', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          id: t.string(),
        },
        backfill: 'skip',
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('BACKFILL skip');
    });

    it("includes indexes block when provided", () => {
      const ds = defineDatasource("test_ds", {
        schema: {
          id: t.string(),
          pipe_name: t.string(),
        },
        indexes: [
          { name: "pipe_name_set", expr: "pipe_name", type: "set(100)", granularity: 1 },
          { name: "id_bf", expr: "lower(id)", type: "bloom_filter(0.001)", granularity: 4 },
        ],
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain("INDEXES >");
      expect(result.content).toContain(
        "pipe_name_set pipe_name TYPE set(100) GRANULARITY 1"
      );
      expect(result.content).toContain(
        "id_bf lower(id) TYPE bloom_filter(0.001) GRANULARITY 4"
      );
    });
  });

  describe('Column formatting', () => {
    it('formats Nullable columns correctly', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          name: t.string().nullable(),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('name Nullable(String)');
    });

    it('formats LowCardinality columns correctly', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          country: t.string().lowCardinality(),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('country LowCardinality(String)');
    });

    it('formats LowCardinality(Nullable) correctly with .lowCardinality().nullable()', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          country: t.string().lowCardinality().nullable(),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('country LowCardinality(Nullable(String))');
      expect(result.content).not.toContain('Nullable(LowCardinality');
    });

    it('formats LowCardinality(Nullable) correctly with .nullable().lowCardinality()', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          country: t.string().nullable().lowCardinality(),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('country LowCardinality(Nullable(String))');
      expect(result.content).not.toContain('Nullable(LowCardinality');
    });

    it('includes default values', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          status: t.string().default('pending'),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain("status String `json:$.status` DEFAULT 'pending'");
    });

    it("includes raw SQL default expressions without quoting", () => {
      const ds = defineDatasource("test_ds", {
        schema: {
          id: t.uuid().defaultExpr("generateUUIDv4()"),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain("id UUID `json:$.id` DEFAULT generateUUIDv4()");
    });

    it('formats null default values', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          // Using nullable with explicit null default
          status: t.string().nullable().default(null),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('DEFAULT NULL');
    });

    it('formats number default values', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          count: t.int32().default(42),
          score: t.float64().default(3.14),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('count Int32 `json:$.count` DEFAULT 42');
      expect(result.content).toContain('score Float64 `json:$.score` DEFAULT 3.14');
    });

    it('formats boolean default values', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          is_active: t.bool().default(true),
          is_deleted: t.bool().default(false),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('is_active Bool `json:$.is_active` DEFAULT 1');
      expect(result.content).toContain('is_deleted Bool `json:$.is_deleted` DEFAULT 0');
    });

    it('formats string default values for DateTime type', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          created_at: t.dateTime().default('2024-01-15 10:30:00'),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain("created_at DateTime `json:$.created_at` DEFAULT '2024-01-15 10:30:00'");
    });

    it('formats string default values for Date type', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          birth_date: t.date().default('2024-01-15'),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain("birth_date Date `json:$.birth_date` DEFAULT '2024-01-15'");
    });

    it('formats array default values', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          tags: t.array(t.string()).default(['a', 'b']),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('tags Array(String) `json:$.tags` DEFAULT ["a","b"]');
    });

    it('formats object default values for JSON type', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          metadata: t.json<{ key: string }>().default({ key: 'value' }),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('metadata JSON `json:$.metadata` DEFAULT {"key":"value"}');
    });

    it('escapes single quotes in string default values', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          message: t.string().default("it's working"),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain("message String `json:$.message` DEFAULT 'it\\'s working'");
    });

    it('includes codec', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          data: t.string().codec('LZ4'),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('data String `json:$.data` CODEC(LZ4)');
    });

    it('adds commas between columns except last', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          id: t.string(),
          name: t.string(),
          count: t.int32(),
        },
      });

      const result = generateDatasource(ds);
      const lines = result.content.split('\n');
      const schemaLines = lines.filter(l => l.trim().startsWith('id') || l.trim().startsWith('name') || l.trim().startsWith('count'));

      expect(schemaLines[0]).toContain(',');
      expect(schemaLines[1]).toContain(',');
      expect(schemaLines[2]).not.toContain(',');
    });

    it('autogenerates jsonPath when jsonPaths is enabled and no explicit path is set', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          event_id: t.string().nullable(),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('event_id Nullable(String) `json:$.event_id`');
    });

    it('uses explicit jsonPath from validator modifier when jsonPaths is enabled', () => {
      const ds = defineDatasource('test_ds', {
        schema: {
          event_id: t.string().nullable().jsonPath('$.explicit_path'),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('event_id Nullable(String) `json:$.explicit_path`');
      expect(result.content).not.toContain('`json:$.event_id`');
    });

    it('omits json paths when jsonPaths is false even if column has explicit jsonPath modifier', () => {
      const ds = defineDatasource('test_ds', {
        jsonPaths: false,
        schema: {
          event_id: t.string().nullable().jsonPath('$.explicit_path'),
        },
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('event_id Nullable(String)');
      expect(result.content).not.toContain('`json:$.explicit_path`');
      expect(result.content).not.toContain('`json:$.event_id`');
    });
  });

  describe('generateAllDatasources', () => {
    it('generates all datasources', () => {
      const ds1 = defineDatasource('ds1', { schema: { id: t.string() } });
      const ds2 = defineDatasource('ds2', { schema: { id: t.int32() } });

      const results = generateAllDatasources({ ds1, ds2 });
      expect(results).toHaveLength(2);
      expect(results.map(r => r.name).sort()).toEqual(['ds1', 'ds2']);
    });
  });

  describe('Full integration', () => {
    it('generates complete datasource file', () => {
      const ds = defineDatasource('page_views', {
        description: 'Page view tracking data',
        schema: {
          timestamp: t.dateTime(),
          pathname: t.string(),
          session_id: t.string(),
          country: t.string().lowCardinality().nullable(),
        },
        engine: engine.mergeTree({
          sortingKey: ['pathname', 'timestamp'],
          partitionKey: 'toYYYYMM(timestamp)',
          ttl: 'timestamp + INTERVAL 90 DAY',
        }),
      });

      const result = generateDatasource(ds);

      expect(result.name).toBe('page_views');
      expect(result.content).toContain('DESCRIPTION >');
      expect(result.content).toContain('Page view tracking data');
      expect(result.content).toContain('SCHEMA >');
      expect(result.content).toContain('timestamp DateTime');
      expect(result.content).toContain('pathname String');
      expect(result.content).toContain('session_id String');
      expect(result.content).toContain('country LowCardinality(Nullable(String))');
      expect(result.content).toContain('ENGINE "MergeTree"');
      expect(result.content).toContain('ENGINE_PARTITION_KEY "toYYYYMM(timestamp)"');
      expect(result.content).toContain('ENGINE_SORTING_KEY "pathname, timestamp"');
      expect(result.content).toContain('ENGINE_TTL "timestamp + INTERVAL 90 DAY"');
    });
  });

  describe('Kafka configuration', () => {
    it('includes Kafka connection name and topic', () => {
      const kafkaConn = defineKafkaConnection('my_kafka', {
        bootstrapServers: 'kafka.example.com:9092',
      });

      const ds = defineDatasource('kafka_events', {
        schema: {
          timestamp: t.dateTime(),
          event: t.string(),
        },
        engine: engine.mergeTree({ sortingKey: ['timestamp'] }),
        kafka: {
          connection: kafkaConn,
          topic: 'events',
        },
      });

      const result = generateDatasource(ds);

      expect(result.content).toContain('KAFKA_CONNECTION_NAME my_kafka');
      expect(result.content).toContain('KAFKA_TOPIC events');
    });

    it('includes Kafka group ID when provided', () => {
      const kafkaConn = defineKafkaConnection('my_kafka', {
        bootstrapServers: 'kafka.example.com:9092',
      });

      const ds = defineDatasource('kafka_events', {
        schema: {
          timestamp: t.dateTime(),
          event: t.string(),
        },
        engine: engine.mergeTree({ sortingKey: ['timestamp'] }),
        kafka: {
          connection: kafkaConn,
          topic: 'events',
          groupId: 'my-consumer-group',
        },
      });

      const result = generateDatasource(ds);

      expect(result.content).toContain('KAFKA_GROUP_ID my-consumer-group');
    });

    it('includes auto offset reset when provided', () => {
      const kafkaConn = defineKafkaConnection('my_kafka', {
        bootstrapServers: 'kafka.example.com:9092',
      });

      const ds = defineDatasource('kafka_events', {
        schema: {
          timestamp: t.dateTime(),
          event: t.string(),
        },
        engine: engine.mergeTree({ sortingKey: ['timestamp'] }),
        kafka: {
          connection: kafkaConn,
          topic: 'events',
          autoOffsetReset: 'earliest',
        },
      });

      const result = generateDatasource(ds);

      expect(result.content).toContain('KAFKA_AUTO_OFFSET_RESET earliest');
    });

    it('includes store raw value when provided', () => {
      const kafkaConn = defineKafkaConnection('my_kafka', {
        bootstrapServers: 'kafka.example.com:9092',
      });

      const ds = defineDatasource('kafka_events', {
        schema: {
          timestamp: t.dateTime(),
          event: t.string(),
        },
        engine: engine.mergeTree({ sortingKey: ['timestamp'] }),
        kafka: {
          connection: kafkaConn,
          topic: 'events',
          storeRawValue: true,
        },
      });

      const result = generateDatasource(ds);

      expect(result.content).toContain('KAFKA_STORE_RAW_VALUE True');
    });

    it('generates complete Kafka datasource with all options', () => {
      const kafkaConn = defineKafkaConnection('my_kafka', {
        bootstrapServers: 'kafka.example.com:9092',
        securityProtocol: 'SASL_SSL',
        saslMechanism: 'PLAIN',
      });

      const ds = defineDatasource('kafka_events', {
        description: 'Events from Kafka',
        schema: {
          timestamp: t.dateTime(),
          event_type: t.string(),
          payload: t.string(),
        },
        engine: engine.mergeTree({ sortingKey: ['timestamp'] }),
        kafka: {
          connection: kafkaConn,
          topic: 'events',
          groupId: 'my-consumer-group',
          autoOffsetReset: 'earliest',
        },
      });

      const result = generateDatasource(ds);

      expect(result.name).toBe('kafka_events');
      expect(result.content).toContain('DESCRIPTION >');
      expect(result.content).toContain('Events from Kafka');
      expect(result.content).toContain('SCHEMA >');
      expect(result.content).toContain('ENGINE "MergeTree"');
      expect(result.content).toContain('KAFKA_CONNECTION_NAME my_kafka');
      expect(result.content).toContain('KAFKA_TOPIC events');
      expect(result.content).toContain('KAFKA_GROUP_ID my-consumer-group');
      expect(result.content).toContain('KAFKA_AUTO_OFFSET_RESET earliest');
    });
  });

  describe('S3 configuration', () => {
    it('includes S3 connection name and bucket uri', () => {
      const s3Conn = defineS3Connection('my_s3', {
        region: 'us-east-1',
        arn: 'arn:aws:iam::123456789012:role/tinybird-s3-access',
      });

      const ds = defineDatasource('s3_events', {
        schema: {
          timestamp: t.dateTime(),
          event: t.string(),
        },
        engine: engine.mergeTree({ sortingKey: ['timestamp'] }),
        s3: {
          connection: s3Conn,
          bucketUri: 's3://my-bucket/events/*.csv',
        },
      });

      const result = generateDatasource(ds);

      expect(result.content).toContain('IMPORT_CONNECTION_NAME my_s3');
      expect(result.content).toContain('IMPORT_BUCKET_URI s3://my-bucket/events/*.csv');
    });

    it('includes optional S3 schedule and from timestamp', () => {
      const s3Conn = defineS3Connection('my_s3', {
        region: 'us-east-1',
        arn: 'arn:aws:iam::123456789012:role/tinybird-s3-access',
      });

      const ds = defineDatasource('s3_events', {
        schema: {
          timestamp: t.dateTime(),
          event: t.string(),
        },
        engine: engine.mergeTree({ sortingKey: ['timestamp'] }),
        s3: {
          connection: s3Conn,
          bucketUri: 's3://my-bucket/events/*.csv',
          schedule: '@auto',
          fromTimestamp: '2024-01-01T00:00:00Z',
        },
      });

      const result = generateDatasource(ds);

      expect(result.content).toContain('IMPORT_SCHEDULE @auto');
      expect(result.content).toContain('IMPORT_FROM_TIMESTAMP 2024-01-01T00:00:00Z');
    });
  });

  describe('GCS configuration', () => {
    it('includes GCS import directives', () => {
      const gcsConn = defineGCSConnection('my_gcs', {
        serviceAccountCredentialsJson: '{{ tb_secret("GCS_SERVICE_ACCOUNT_CREDENTIALS_JSON") }}',
      });

      const ds = defineDatasource('gcs_events', {
        schema: {
          timestamp: t.dateTime(),
          event: t.string(),
        },
        engine: engine.mergeTree({ sortingKey: ['timestamp'] }),
        gcs: {
          connection: gcsConn,
          bucketUri: 'gs://my-bucket/events/*.csv',
          schedule: '@auto',
          fromTimestamp: '2024-01-01T00:00:00Z',
        },
      });

      const result = generateDatasource(ds);

      expect(result.content).toContain('IMPORT_CONNECTION_NAME my_gcs');
      expect(result.content).toContain('IMPORT_BUCKET_URI gs://my-bucket/events/*.csv');
      expect(result.content).toContain('IMPORT_SCHEDULE @auto');
      expect(result.content).toContain('IMPORT_FROM_TIMESTAMP 2024-01-01T00:00:00Z');
    });
  });

  describe('DynamoDB configuration', () => {
    it('includes DynamoDB import directives', () => {
      const dynamoConn = defineDynamoDBConnection('my_dynamo', {
        region: 'us-east-1',
        arn: '{{ tb_secret("DYNAMODB_ROLE_ARN") }}',
      });

      const ds = defineDatasource('dynamo_events', {
        schema: {
          id: t.string(),
          _record: t.string(),
        },
        engine: engine.replacingMergeTree({ sortingKey: ['id'] }),
        dynamodb: {
          connection: dynamoConn,
          tableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/events',
          exportBucket: 's3://my-export-bucket',
        },
      });

      const result = generateDatasource(ds);

      expect(result.content).toContain('IMPORT_CONNECTION_NAME my_dynamo');
      expect(result.content).toContain(
        'IMPORT_TABLE_ARN arn:aws:dynamodb:us-east-1:123456789012:table/events'
      );
      expect(result.content).toContain('IMPORT_EXPORT_BUCKET s3://my-export-bucket');
    });

    it('rejects mixing DynamoDB with other ingestion options', () => {
      const dynamoConn = defineDynamoDBConnection('my_dynamo', {
        region: 'us-east-1',
        arn: '{{ tb_secret("DYNAMODB_ROLE_ARN") }}',
      });
      const s3Conn = defineS3Connection('my_s3', {
        region: 'us-east-1',
        arn: 'arn:aws:iam::123456789012:role/x',
      });

      expect(() =>
        defineDatasource('mixed', {
          schema: { id: t.string() },
          dynamodb: {
            connection: dynamoConn,
            tableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/events',
            exportBucket: 's3://my-export-bucket',
          },
          s3: { connection: s3Conn, bucketUri: 's3://b/*.csv' },
        })
      ).toThrow('only define one ingestion option');
    });
  });

  describe('Token generation', () => {
    it('generates TOKEN lines with inline config', () => {
      const ds = defineDatasource('test_ds', {
        schema: { id: t.string() },
        tokens: [{ name: 'app_read', permissions: ['READ'] }],
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('TOKEN app_read READ');
    });

    it('generates TOKEN lines with multiple permissions', () => {
      const ds = defineDatasource('test_ds', {
        schema: { id: t.string() },
        tokens: [{ name: 'app_token', permissions: ['READ', 'APPEND'] }],
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('TOKEN app_token READ');
      expect(result.content).toContain('TOKEN app_token APPEND');
    });

    it('generates TOKEN lines with token reference', () => {
      const appToken = defineToken('my_token');
      const ds = defineDatasource('test_ds', {
        schema: { id: t.string() },
        tokens: [{ token: appToken, scope: 'READ' }],
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('TOKEN my_token READ');
    });

    it('generates TOKEN lines with token reference and APPEND scope', () => {
      const appendToken = defineToken('append_token');
      const ds = defineDatasource('test_ds', {
        schema: { id: t.string() },
        tokens: [{ token: appendToken, scope: 'APPEND' }],
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('TOKEN append_token APPEND');
    });

    it('generates multiple TOKEN lines for multiple tokens', () => {
      const readToken = defineToken('read_token');
      const appendToken = defineToken('append_token');
      const ds = defineDatasource('test_ds', {
        schema: { id: t.string() },
        tokens: [
          { token: readToken, scope: 'READ' },
          { token: appendToken, scope: 'APPEND' },
        ],
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('TOKEN read_token READ');
      expect(result.content).toContain('TOKEN append_token APPEND');
    });

    it('generates mixed inline and reference tokens', () => {
      const refToken = defineToken('ref_token');
      const ds = defineDatasource('test_ds', {
        schema: { id: t.string() },
        tokens: [
          { name: 'inline_token', permissions: ['READ'] },
          { token: refToken, scope: 'APPEND' },
        ],
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('TOKEN inline_token READ');
      expect(result.content).toContain('TOKEN ref_token APPEND');
    });
  });

  describe('Shared with configuration', () => {
    it('generates SHARED_WITH for single workspace', () => {
      const ds = defineDatasource('test_ds', {
        schema: { id: t.string() },
        sharedWith: ['other_workspace'],
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('SHARED_WITH >');
      expect(result.content).toContain('    other_workspace');
    });

    it('generates SHARED_WITH for multiple workspaces', () => {
      const ds = defineDatasource('test_ds', {
        schema: { id: t.string() },
        sharedWith: ['workspace_a', 'workspace_b'],
      });

      const result = generateDatasource(ds);
      expect(result.content).toContain('SHARED_WITH >');
      expect(result.content).toContain('    workspace_a,');
      expect(result.content).toContain('    workspace_b');
    });

    it('does not include SHARED_WITH when not provided', () => {
      const ds = defineDatasource('test_ds', {
        schema: { id: t.string() },
      });

      const result = generateDatasource(ds);
      expect(result.content).not.toContain('SHARED_WITH');
    });

    it('does not include SHARED_WITH when empty array', () => {
      const ds = defineDatasource('test_ds', {
        schema: { id: t.string() },
        sharedWith: [],
      });

      const result = generateDatasource(ds);
      expect(result.content).not.toContain('SHARED_WITH');
    });
  });
});
