import { describe, it, expect } from "vitest";
import {
  defineDatasource,
  isDatasourceDefinition,
  getColumnType,
  getColumnJsonPath,
  getColumnNames,
  column,
} from "./datasource.js";
import { t, type AnyTypeValidator } from "./types.js";
import { engine } from "./engines.js";
import { defineKafkaConnection, defineS3Connection, defineGCSConnection } from "./connection.js";

describe("Datasource Schema", () => {
  describe("defineDatasource", () => {
    it("creates a datasource with required fields", () => {
      const ds = defineDatasource("events", {
        schema: {
          id: t.string(),
          timestamp: t.dateTime(),
        },
      });

      expect(ds._name).toBe("events");
      expect(ds._type).toBe("datasource");
      expect(ds.options.schema).toBeDefined();
      expect(ds.options.engine).toBeUndefined();
    });

    it("creates a datasource with description", () => {
      const ds = defineDatasource("events", {
        description: "Event tracking data",
        schema: {
          id: t.string(),
        },
      });

      expect(ds.options.description).toBe("Event tracking data");
    });

    it("creates a datasource with engine configuration", () => {
      const ds = defineDatasource("events", {
        schema: {
          id: t.string(),
          timestamp: t.dateTime(),
        },
        engine: engine.mergeTree({
          sortingKey: ["id", "timestamp"],
          partitionKey: "toYYYYMM(timestamp)",
        }),
      });

      expect(ds.options.engine).toBeDefined();
      expect(ds.options.engine?.type).toBe("MergeTree");
    });

    it("throws error for invalid datasource name", () => {
      expect(() =>
        defineDatasource("123invalid", {
          schema: { id: t.string() },
        })
      ).toThrow("Invalid datasource name");

      expect(() =>
        defineDatasource("my-datasource", {
          schema: { id: t.string() },
        })
      ).toThrow("Invalid datasource name");

      expect(() =>
        defineDatasource("", {
          schema: { id: t.string() },
        })
      ).toThrow("Invalid datasource name");
    });

    it("allows valid naming patterns", () => {
      // Underscore prefix
      const ds1 = defineDatasource("_private", {
        schema: { id: t.string() },
      });
      expect(ds1._name).toBe("_private");

      // With numbers
      const ds2 = defineDatasource("events_v2", {
        schema: { id: t.string() },
      });
      expect(ds2._name).toBe("events_v2");
    });

    it("throws when multiple ingestion configs are configured", () => {
      const kafkaConn = defineKafkaConnection("my_kafka", {
        bootstrapServers: "kafka.example.com:9092",
      });
      const s3Conn = defineS3Connection("my_s3", {
        region: "us-east-1",
        arn: "arn:aws:iam::123456789012:role/tinybird-s3-access",
      });
      const gcsConn = defineGCSConnection("my_gcs", {
        serviceAccountCredentialsJson: '{{ tb_secret("GCS_SERVICE_ACCOUNT_CREDENTIALS_JSON") }}',
      });

      expect(() =>
        defineDatasource("events", {
          schema: { id: t.string() },
          kafka: {
            connection: kafkaConn,
            topic: "events",
          },
          s3: {
            connection: s3Conn,
            bucketUri: "s3://my-bucket/events/*.csv",
          },
        })
      ).toThrow("Datasource can only define one ingestion option: `kafka`, `s3`, `gcs`, or `dynamodb`.");

      expect(() =>
        defineDatasource("events_gcs", {
          schema: { id: t.string() },
          kafka: {
            connection: kafkaConn,
            topic: "events",
          },
          gcs: {
            connection: gcsConn,
            bucketUri: "gs://my-bucket/events/*.csv",
          },
        })
      ).toThrow("Datasource can only define one ingestion option: `kafka`, `s3`, `gcs`, or `dynamodb`.");
    });

    it("accepts gcs ingestion configuration", () => {
      const gcsConn = defineGCSConnection("my_gcs", {
        serviceAccountCredentialsJson: '{{ tb_secret("GCS_SERVICE_ACCOUNT_CREDENTIALS_JSON") }}',
      });

      const ds = defineDatasource("events_gcs", {
        schema: { id: t.string() },
        gcs: {
          connection: gcsConn,
          bucketUri: "gs://my-bucket/events/*.csv",
          schedule: "@auto",
        },
      });

      expect(ds.options.gcs?.connection._name).toBe("my_gcs");
      expect(ds.options.gcs?.bucketUri).toBe("gs://my-bucket/events/*.csv");
    });

    it("accepts datasource indexes", () => {
      const ds = defineDatasource("events", {
        schema: { id: t.string() },
        indexes: [
          {
            name: "id_set",
            expr: "id",
            type: "set(100)",
            granularity: 1,
          },
        ],
      });

      expect(ds.options.indexes).toEqual([
        {
          name: "id_set",
          expr: "id",
          type: "set(100)",
          granularity: 1,
        },
      ]);
    });

    it("accepts backfill skip configuration", () => {
      const ds = defineDatasource("events_rollup", {
        schema: { id: t.string() },
        backfill: "skip",
      });

      expect(ds.options.backfill).toBe("skip");
    });

    it("validates datasource index fields", () => {
      expect(() =>
        defineDatasource("events", {
          schema: { id: t.string() },
          indexes: [{ name: "invalid name", expr: "id", type: "set(100)", granularity: 1 }],
        })
      ).toThrow("Invalid datasource index name");

      expect(() =>
        defineDatasource("events", {
          schema: { id: t.string() },
          indexes: [{ name: "id_set", expr: "", type: "set(100)", granularity: 1 }],
        })
      ).toThrow('Invalid datasource index "id_set": expr is required.');

      expect(() =>
        defineDatasource("events", {
          schema: { id: t.string() },
          indexes: [{ name: "id_set", expr: "id", type: "", granularity: 1 }],
        })
      ).toThrow('Invalid datasource index "id_set": type is required.');

      expect(() =>
        defineDatasource("events", {
          schema: { id: t.string() },
          indexes: [{ name: "id_set", expr: "id", type: "set(100)", granularity: 0 }],
        })
      ).toThrow('Invalid datasource index "id_set": granularity must be a positive integer.');
    });
  });

  describe("isDatasourceDefinition", () => {
    it("returns true for valid datasource", () => {
      const ds = defineDatasource("events", {
        schema: { id: t.string() },
      });

      expect(isDatasourceDefinition(ds)).toBe(true);
    });

    it("returns false for non-datasource objects", () => {
      expect(isDatasourceDefinition({})).toBe(false);
      expect(isDatasourceDefinition(null)).toBe(false);
      expect(isDatasourceDefinition(undefined)).toBe(false);
      expect(isDatasourceDefinition("string")).toBe(false);
      expect(isDatasourceDefinition(123)).toBe(false);
      expect(isDatasourceDefinition({ _name: "test" })).toBe(false);
    });
  });

  describe("getColumnType", () => {
    it("returns type from raw validator", () => {
      const validator = t.string();
      const result = getColumnType(validator);

      expect(result).toBe(validator);
    });

    it("returns type from column definition", () => {
      const validator = t.string();
      const col = column(validator, { jsonPath: "$.id" });
      const result = getColumnType(col);

      expect(result).toBe(validator);
    });
  });

  describe("getColumnJsonPath", () => {
    it("returns undefined for raw validator", () => {
      const validator = t.string();
      const result = getColumnJsonPath(validator);

      expect(result).toBeUndefined();
    });

    it("returns jsonPath from column definition", () => {
      const col = column(t.string(), { jsonPath: "$.user.id" });
      const result = getColumnJsonPath(col);

      expect(result).toBe("$.user.id");
    });

    it("returns undefined when jsonPath is not set", () => {
      const col = column(t.string());
      const result = getColumnJsonPath(col);

      expect(result).toBeUndefined();
    });

    it("never returns a function when validator branding is missing", () => {
      const validator = t.string();
      // Simulate a validator-like object where isTypeValidator() fails by
      // removing symbol keys (including the validator brand).
      const unbrandedValidator = Object.fromEntries(
        Object.entries(validator as unknown as Record<string, unknown>)
      ) as unknown as AnyTypeValidator;

      const result = getColumnJsonPath(unbrandedValidator);

      expect(result).toBeUndefined();
      expect(typeof result).not.toBe("function");
    });

    it("returns jsonPath from validator modifier", () => {
      const validator = t.string().jsonPath("$.user.id");
      const result = getColumnJsonPath(validator);

      expect(result).toBe("$.user.id");
    });

    it("prefers column definition jsonPath over validator modifier", () => {
      const col = column(t.string().jsonPath("$.from_validator"), {
        jsonPath: "$.from_column",
      });
      const result = getColumnJsonPath(col);

      expect(result).toBe("$.from_column");
    });
  });

  describe("getColumnNames", () => {
    it("returns all column names from schema", () => {
      const schema = {
        id: t.string(),
        timestamp: t.dateTime(),
        user_id: t.string(),
      };

      const names = getColumnNames(schema);

      expect(names).toHaveLength(3);
      expect(names).toContain("id");
      expect(names).toContain("timestamp");
      expect(names).toContain("user_id");
    });

    it("returns empty array for empty schema", () => {
      const names = getColumnNames({});

      expect(names).toHaveLength(0);
    });
  });

  describe("column", () => {
    it("creates a column definition with type only", () => {
      const col = column(t.string());

      expect(col.type).toBeDefined();
      expect(col.jsonPath).toBeUndefined();
    });

    it("creates a column definition with jsonPath", () => {
      const col = column(t.string(), { jsonPath: "$.data.value" });

      expect(col.type).toBeDefined();
      expect(col.jsonPath).toBe("$.data.value");
    });
  });
});
