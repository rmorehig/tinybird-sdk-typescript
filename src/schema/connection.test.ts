import { describe, it, expect } from "vitest";
import {
  defineKafkaConnection,
  defineS3Connection,
  defineGCSConnection,
  defineDynamoDBConnection,
  isConnectionDefinition,
  isKafkaConnectionDefinition,
  isS3ConnectionDefinition,
  isGCSConnectionDefinition,
  isDynamoDBConnectionDefinition,
  getConnectionType,
} from "./connection.js";

describe("Connection Schema", () => {
  describe("defineKafkaConnection", () => {
    it("creates a Kafka connection with required fields", () => {
      const conn = defineKafkaConnection("my_kafka", {
        bootstrapServers: "kafka.example.com:9092",
      });

      expect(conn._name).toBe("my_kafka");
      expect(conn._type).toBe("connection");
      expect(conn._connectionType).toBe("kafka");
      expect(conn.options.bootstrapServers).toBe("kafka.example.com:9092");
    });

    it("creates a Kafka connection with all options", () => {
      const conn = defineKafkaConnection("my_kafka", {
        bootstrapServers: "kafka.example.com:9092",
        securityProtocol: "SASL_SSL",
        saslMechanism: "PLAIN",
        key: '{{ tb_secret("KAFKA_KEY") }}',
        secret: '{{ tb_secret("KAFKA_SECRET") }}',
        sslCaPem: '{{ tb_secret("KAFKA_CA_CERT") }}',
      });

      expect(conn.options.securityProtocol).toBe("SASL_SSL");
      expect(conn.options.saslMechanism).toBe("PLAIN");
      expect(conn.options.key).toBe('{{ tb_secret("KAFKA_KEY") }}');
      expect(conn.options.secret).toBe('{{ tb_secret("KAFKA_SECRET") }}');
      expect(conn.options.sslCaPem).toBe('{{ tb_secret("KAFKA_CA_CERT") }}');
    });

    it("supports different SASL mechanisms", () => {
      const scramConn = defineKafkaConnection("scram_kafka", {
        bootstrapServers: "kafka.example.com:9092",
        saslMechanism: "SCRAM-SHA-256",
      });
      expect(scramConn.options.saslMechanism).toBe("SCRAM-SHA-256");

      const scram512Conn = defineKafkaConnection("scram512_kafka", {
        bootstrapServers: "kafka.example.com:9092",
        saslMechanism: "SCRAM-SHA-512",
      });
      expect(scram512Conn.options.saslMechanism).toBe("SCRAM-SHA-512");

      const oauthConn = defineKafkaConnection("oauth_kafka", {
        bootstrapServers: "kafka.example.com:9092",
        saslMechanism: "OAUTHBEARER",
      });
      expect(oauthConn.options.saslMechanism).toBe("OAUTHBEARER");
    });

    it("creates a Kafka connection with AWS IAM OAUTHBEARER auth", () => {
      const conn = defineKafkaConnection("aws_msk", {
        bootstrapServers: "b-1.msk.example.com:9098,b-2.msk.example.com:9098",
        securityProtocol: "SASL_SSL",
        saslMechanism: "OAUTHBEARER",
        saslOauthbearerMethod: "AWS",
        saslOauthbearerAwsRegion: "eu-west-1",
        saslOauthbearerAwsRoleArn: '{{ tb_secret("KAFKA_AWS_ROLE_ARN") }}',
        saslOauthbearerAwsExternalId: '{{ tb_secret("KAFKA_AWS_EXTERNAL_ID") }}',
      });

      expect(conn.options.saslOauthbearerMethod).toBe("AWS");
      expect(conn.options.saslOauthbearerAwsRegion).toBe("eu-west-1");
      expect(conn.options.saslOauthbearerAwsRoleArn).toBe(
        '{{ tb_secret("KAFKA_AWS_ROLE_ARN") }}'
      );
      expect(conn.options.saslOauthbearerAwsExternalId).toBe(
        '{{ tb_secret("KAFKA_AWS_EXTERNAL_ID") }}'
      );
    });

    it("supports different security protocols", () => {
      const plaintext = defineKafkaConnection("plaintext_kafka", {
        bootstrapServers: "localhost:9092",
        securityProtocol: "PLAINTEXT",
      });
      expect(plaintext.options.securityProtocol).toBe("PLAINTEXT");

      const saslPlaintext = defineKafkaConnection("sasl_plaintext_kafka", {
        bootstrapServers: "localhost:9092",
        securityProtocol: "SASL_PLAINTEXT",
      });
      expect(saslPlaintext.options.securityProtocol).toBe("SASL_PLAINTEXT");
    });

    it("throws error for invalid connection name", () => {
      expect(() =>
        defineKafkaConnection("123invalid", {
          bootstrapServers: "kafka.example.com:9092",
        })
      ).toThrow("Invalid connection name");

      expect(() =>
        defineKafkaConnection("my-connection", {
          bootstrapServers: "kafka.example.com:9092",
        })
      ).toThrow("Invalid connection name");

      expect(() =>
        defineKafkaConnection("", {
          bootstrapServers: "kafka.example.com:9092",
        })
      ).toThrow("Invalid connection name");
    });

    it("allows valid naming patterns", () => {
      const conn1 = defineKafkaConnection("_private_kafka", {
        bootstrapServers: "kafka.example.com:9092",
      });
      expect(conn1._name).toBe("_private_kafka");

      const conn2 = defineKafkaConnection("kafka_v2", {
        bootstrapServers: "kafka.example.com:9092",
      });
      expect(conn2._name).toBe("kafka_v2");
    });
  });

  describe("defineS3Connection", () => {
    it("creates an S3 connection with IAM role auth", () => {
      const conn = defineS3Connection("my_s3", {
        region: "us-east-1",
        arn: "arn:aws:iam::123456789012:role/tinybird-s3-access",
      });

      expect(conn._name).toBe("my_s3");
      expect(conn._type).toBe("connection");
      expect(conn._connectionType).toBe("s3");
      expect(conn.options.region).toBe("us-east-1");
      expect(conn.options.arn).toBe("arn:aws:iam::123456789012:role/tinybird-s3-access");
    });

    it("creates an S3 connection with access key auth", () => {
      const conn = defineS3Connection("my_s3", {
        region: "us-east-1",
        accessKey: '{{ tb_secret("S3_ACCESS_KEY") }}',
        secret: '{{ tb_secret("S3_SECRET") }}',
      });

      expect(conn.options.accessKey).toBe('{{ tb_secret("S3_ACCESS_KEY") }}');
      expect(conn.options.secret).toBe('{{ tb_secret("S3_SECRET") }}');
    });

    it("throws when auth config is incomplete", () => {
      expect(() =>
        defineS3Connection("my_s3", {
          region: "us-east-1",
        })
      ).toThrow("S3 connection requires either `arn` or both `accessKey` and `secret`.");

      expect(() =>
        defineS3Connection("my_s3", {
          region: "us-east-1",
          accessKey: "key-only",
        })
      ).toThrow("S3 connection requires either `arn` or both `accessKey` and `secret`.");

      expect(() =>
        defineS3Connection("my_s3", {
          region: "us-east-1",
          secret: "secret-only",
        })
      ).toThrow("S3 connection requires either `arn` or both `accessKey` and `secret`.");
    });
  });

  describe("defineGCSConnection", () => {
    it("creates a GCS connection with required fields", () => {
      const conn = defineGCSConnection("my_gcs", {
        serviceAccountCredentialsJson: '{{ tb_secret("GCS_SERVICE_ACCOUNT_CREDENTIALS_JSON") }}',
      });

      expect(conn._name).toBe("my_gcs");
      expect(conn._type).toBe("connection");
      expect(conn._connectionType).toBe("gcs");
      expect(conn.options.serviceAccountCredentialsJson).toBe(
        '{{ tb_secret("GCS_SERVICE_ACCOUNT_CREDENTIALS_JSON") }}'
      );
    });

    it("throws when credentials json is empty", () => {
      expect(() =>
        defineGCSConnection("my_gcs", {
          serviceAccountCredentialsJson: "   ",
        })
      ).toThrow("GCS connection `serviceAccountCredentialsJson` is required.");
    });
  });

  describe("defineDynamoDBConnection", () => {
    it("creates a DynamoDB connection with required fields", () => {
      const conn = defineDynamoDBConnection("my_dynamo", {
        region: "us-east-1",
        arn: '{{ tb_secret("DYNAMODB_ROLE_ARN") }}',
      });

      expect(conn._name).toBe("my_dynamo");
      expect(conn._type).toBe("connection");
      expect(conn._connectionType).toBe("dynamodb");
      expect(conn.options.region).toBe("us-east-1");
      expect(conn.options.arn).toBe('{{ tb_secret("DYNAMODB_ROLE_ARN") }}');
    });

    it("throws when region is missing", () => {
      expect(() =>
        defineDynamoDBConnection("my_dynamo", {
          region: "   ",
          arn: '{{ tb_secret("DYNAMODB_ROLE_ARN") }}',
        })
      ).toThrow("DynamoDB connection `region` is required.");
    });

    it("throws when arn is missing", () => {
      expect(() =>
        defineDynamoDBConnection("my_dynamo", {
          region: "us-east-1",
          arn: "",
        })
      ).toThrow("DynamoDB connection `arn` is required.");
    });

    it("throws for invalid connection name", () => {
      expect(() =>
        defineDynamoDBConnection("123-invalid", {
          region: "us-east-1",
          arn: '{{ tb_secret("DYNAMODB_ROLE_ARN") }}',
        })
      ).toThrow("Invalid connection name");
    });
  });

  describe("isConnectionDefinition", () => {
    it("returns true for valid connection", () => {
      const conn = defineKafkaConnection("my_kafka", {
        bootstrapServers: "kafka.example.com:9092",
      });

      expect(isConnectionDefinition(conn)).toBe(true);
    });

    it("returns false for non-connection objects", () => {
      expect(isConnectionDefinition({})).toBe(false);
      expect(isConnectionDefinition(null)).toBe(false);
      expect(isConnectionDefinition(undefined)).toBe(false);
      expect(isConnectionDefinition("string")).toBe(false);
      expect(isConnectionDefinition(123)).toBe(false);
      expect(isConnectionDefinition({ _name: "test" })).toBe(false);
    });
  });

  describe("isKafkaConnectionDefinition", () => {
    it("returns true for Kafka connection", () => {
      const conn = defineKafkaConnection("my_kafka", {
        bootstrapServers: "kafka.example.com:9092",
      });

      expect(isKafkaConnectionDefinition(conn)).toBe(true);
    });

    it("returns false for non-Kafka objects", () => {
      expect(isKafkaConnectionDefinition({})).toBe(false);
      expect(isKafkaConnectionDefinition(null)).toBe(false);
    });
  });

  describe("isS3ConnectionDefinition", () => {
    it("returns true for S3 connection", () => {
      const conn = defineS3Connection("my_s3", {
        region: "us-east-1",
        arn: "arn:aws:iam::123456789012:role/tinybird-s3-access",
      });

      expect(isS3ConnectionDefinition(conn)).toBe(true);
    });

    it("returns false for non-S3 objects", () => {
      expect(isS3ConnectionDefinition({})).toBe(false);
      expect(isS3ConnectionDefinition(null)).toBe(false);
    });
  });

  describe("isGCSConnectionDefinition", () => {
    it("returns true for GCS connection", () => {
      const conn = defineGCSConnection("my_gcs", {
        serviceAccountCredentialsJson: '{{ tb_secret("GCS_SERVICE_ACCOUNT_CREDENTIALS_JSON") }}',
      });

      expect(isGCSConnectionDefinition(conn)).toBe(true);
    });

    it("returns false for non-GCS objects", () => {
      expect(isGCSConnectionDefinition({})).toBe(false);
      expect(isGCSConnectionDefinition(null)).toBe(false);
    });
  });

  describe("isDynamoDBConnectionDefinition", () => {
    it("returns true for DynamoDB connection", () => {
      const conn = defineDynamoDBConnection("my_dynamo", {
        region: "us-east-1",
        arn: '{{ tb_secret("DYNAMODB_ROLE_ARN") }}',
      });

      expect(isDynamoDBConnectionDefinition(conn)).toBe(true);
    });

    it("returns false for non-DynamoDB objects", () => {
      expect(isDynamoDBConnectionDefinition({})).toBe(false);
      expect(isDynamoDBConnectionDefinition(null)).toBe(false);
      expect(
        isDynamoDBConnectionDefinition(
          defineS3Connection("my_s3", { region: "us-east-1", arn: "arn:aws:iam::1:role/x" })
        )
      ).toBe(false);
    });
  });

  describe("getConnectionType", () => {
    it("returns the connection type", () => {
      const conn = defineKafkaConnection("my_kafka", {
        bootstrapServers: "kafka.example.com:9092",
      });

      expect(getConnectionType(conn)).toBe("kafka");
    });

    it("returns the s3 connection type", () => {
      const conn = defineS3Connection("my_s3", {
        region: "us-east-1",
        arn: "arn:aws:iam::123456789012:role/tinybird-s3-access",
      });

      expect(getConnectionType(conn)).toBe("s3");
    });

    it("returns the gcs connection type", () => {
      const conn = defineGCSConnection("my_gcs", {
        serviceAccountCredentialsJson: '{{ tb_secret("GCS_SERVICE_ACCOUNT_CREDENTIALS_JSON") }}',
      });

      expect(getConnectionType(conn)).toBe("gcs");
    });
  });
});
