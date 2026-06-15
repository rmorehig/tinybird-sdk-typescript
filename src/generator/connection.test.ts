import { describe, it, expect } from "vitest";
import { generateConnection, generateAllConnections } from "./connection.js";
import {
  defineKafkaConnection,
  defineS3Connection,
  defineGCSConnection,
  defineDynamoDBConnection,
} from "../schema/connection.js";

describe("Connection Generator", () => {
  describe("generateConnection", () => {
    it("generates basic Kafka connection with required fields", () => {
      const conn = defineKafkaConnection("my_kafka", {
        bootstrapServers: "kafka.example.com:9092",
      });

      const result = generateConnection(conn);

      expect(result.name).toBe("my_kafka");
      expect(result.content).toContain("TYPE kafka");
      expect(result.content).toContain("KAFKA_BOOTSTRAP_SERVERS kafka.example.com:9092");
    });

    it("includes security protocol when provided", () => {
      const conn = defineKafkaConnection("my_kafka", {
        bootstrapServers: "kafka.example.com:9092",
        securityProtocol: "SASL_SSL",
      });

      const result = generateConnection(conn);

      expect(result.content).toContain("KAFKA_SECURITY_PROTOCOL SASL_SSL");
    });

    it("includes SASL mechanism when provided", () => {
      const conn = defineKafkaConnection("my_kafka", {
        bootstrapServers: "kafka.example.com:9092",
        saslMechanism: "PLAIN",
      });

      const result = generateConnection(conn);

      expect(result.content).toContain("KAFKA_SASL_MECHANISM PLAIN");
    });

    it("includes key and secret when provided", () => {
      const conn = defineKafkaConnection("my_kafka", {
        bootstrapServers: "kafka.example.com:9092",
        key: '{{ tb_secret("KAFKA_KEY") }}',
        secret: '{{ tb_secret("KAFKA_SECRET") }}',
      });

      const result = generateConnection(conn);

      expect(result.content).toContain('KAFKA_KEY {{ tb_secret("KAFKA_KEY") }}');
      expect(result.content).toContain('KAFKA_SECRET {{ tb_secret("KAFKA_SECRET") }}');
    });

    it("includes schema registry URL when provided", () => {
      const conn = defineKafkaConnection("my_kafka", {
        bootstrapServers: "kafka.example.com:9092",
        schemaRegistryUrl: "https://registry-user:registry-pass@registry.example.com",
      });

      const result = generateConnection(conn);

      expect(result.content).toContain(
        "KAFKA_SCHEMA_REGISTRY_URL https://registry-user:registry-pass@registry.example.com"
      );
    });

    it("includes SSL CA PEM when provided", () => {
      const conn = defineKafkaConnection("my_kafka", {
        bootstrapServers: "kafka.example.com:9092",
        sslCaPem: '{{ tb_secret("KAFKA_CA_CERT") }}',
      });

      const result = generateConnection(conn);

      expect(result.content).toContain('KAFKA_SSL_CA_PEM {{ tb_secret("KAFKA_CA_CERT") }}');
    });

    it("emits multiline SSL CA PEM with > syntax", () => {
      const conn = defineKafkaConnection("my_kafka", {
        bootstrapServers: "kafka.example.com:9092",
        sslCaPem: "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAM\n-----END CERTIFICATE-----",
      });

      const result = generateConnection(conn);

      expect(result.content).toContain("KAFKA_SSL_CA_PEM >");
      expect(result.content).toContain("    -----BEGIN CERTIFICATE-----");
      expect(result.content).toContain("    MIIDXTCCAkWgAwIBAgIJAM");
      expect(result.content).toContain("    -----END CERTIFICATE-----");
    });

    it("emits single-line SSL CA PEM for secret references", () => {
      const conn = defineKafkaConnection("my_kafka", {
        bootstrapServers: "kafka.example.com:9092",
        sslCaPem: "{{ tb_secret('KAFKA_CA_CERT') }}",
      });

      const result = generateConnection(conn);

      expect(result.content).toContain("KAFKA_SSL_CA_PEM {{ tb_secret('KAFKA_CA_CERT') }}");
    });

    it("generates full Kafka connection with all options", () => {
      const conn = defineKafkaConnection("my_kafka", {
        bootstrapServers: "kafka.example.com:9092",
        securityProtocol: "SASL_SSL",
        saslMechanism: "SCRAM-SHA-256",
        key: '{{ tb_secret("KAFKA_KEY") }}',
        secret: '{{ tb_secret("KAFKA_SECRET") }}',
        sslCaPem: '{{ tb_secret("KAFKA_CA_CERT") }}',
      });

      const result = generateConnection(conn);

      expect(result.name).toBe("my_kafka");
      expect(result.content).toContain("TYPE kafka");
      expect(result.content).toContain("KAFKA_BOOTSTRAP_SERVERS kafka.example.com:9092");
      expect(result.content).toContain("KAFKA_SECURITY_PROTOCOL SASL_SSL");
      expect(result.content).toContain("KAFKA_SASL_MECHANISM SCRAM-SHA-256");
      expect(result.content).toContain('KAFKA_KEY {{ tb_secret("KAFKA_KEY") }}');
      expect(result.content).toContain('KAFKA_SECRET {{ tb_secret("KAFKA_SECRET") }}');
      expect(result.content).toContain('KAFKA_SSL_CA_PEM {{ tb_secret("KAFKA_CA_CERT") }}');
    });

    it("supports PLAINTEXT security protocol", () => {
      const conn = defineKafkaConnection("local_kafka", {
        bootstrapServers: "localhost:9092",
        securityProtocol: "PLAINTEXT",
      });

      const result = generateConnection(conn);

      expect(result.content).toContain("KAFKA_SECURITY_PROTOCOL PLAINTEXT");
    });

    it("supports different SASL mechanisms", () => {
      const mechanisms = ["PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512", "OAUTHBEARER"] as const;

      mechanisms.forEach((mechanism) => {
        const conn = defineKafkaConnection("my_kafka", {
          bootstrapServers: "kafka.example.com:9092",
          saslMechanism: mechanism,
        });

        const result = generateConnection(conn);

        expect(result.content).toContain(`KAFKA_SASL_MECHANISM ${mechanism}`);
      });
    });

    it("generates Kafka AWS IAM OAUTHBEARER settings", () => {
      const conn = defineKafkaConnection("aws_msk", {
        bootstrapServers: "b-1.msk.example.com:9098,b-2.msk.example.com:9098",
        securityProtocol: "SASL_SSL",
        saslMechanism: "OAUTHBEARER",
        saslOauthbearerMethod: "AWS",
        saslOauthbearerAwsRegion: "eu-west-1",
        saslOauthbearerAwsRoleArn: '{{ tb_secret("KAFKA_AWS_ROLE_ARN") }}',
        saslOauthbearerAwsExternalId: '{{ tb_secret("KAFKA_AWS_EXTERNAL_ID") }}',
      });

      const result = generateConnection(conn);

      expect(result.content).toContain("KAFKA_SASL_OAUTHBEARER_METHOD AWS");
      expect(result.content).toContain("KAFKA_SASL_OAUTHBEARER_AWS_REGION eu-west-1");
      expect(result.content).toContain(
        'KAFKA_SASL_OAUTHBEARER_AWS_ROLE_ARN {{ tb_secret("KAFKA_AWS_ROLE_ARN") }}'
      );
      expect(result.content).toContain(
        'KAFKA_SASL_OAUTHBEARER_AWS_EXTERNAL_ID {{ tb_secret("KAFKA_AWS_EXTERNAL_ID") }}'
      );
    });

    it("generates basic S3 connection with IAM role auth", () => {
      const conn = defineS3Connection("my_s3", {
        region: "us-east-1",
        arn: "arn:aws:iam::123456789012:role/tinybird-s3-access",
      });

      const result = generateConnection(conn);

      expect(result.name).toBe("my_s3");
      expect(result.content).toContain("TYPE s3");
      expect(result.content).toContain("S3_REGION us-east-1");
      expect(result.content).toContain(
        "S3_ARN arn:aws:iam::123456789012:role/tinybird-s3-access"
      );
    });

    it("generates S3 connection with access key auth", () => {
      const conn = defineS3Connection("my_s3", {
        region: "us-east-1",
        accessKey: '{{ tb_secret("S3_ACCESS_KEY") }}',
        secret: '{{ tb_secret("S3_SECRET") }}',
      });

      const result = generateConnection(conn);

      expect(result.content).toContain("TYPE s3");
      expect(result.content).toContain('S3_ACCESS_KEY {{ tb_secret("S3_ACCESS_KEY") }}');
      expect(result.content).toContain('S3_SECRET {{ tb_secret("S3_SECRET") }}');
    });

    it("generates GCS connection with service account credentials", () => {
      const conn = defineGCSConnection("my_gcs", {
        serviceAccountCredentialsJson: '{{ tb_secret("GCS_SERVICE_ACCOUNT_CREDENTIALS_JSON") }}',
      });

      const result = generateConnection(conn);

      expect(result.name).toBe("my_gcs");
      expect(result.content).toContain("TYPE gcs");
      expect(result.content).toContain(
        'GCS_SERVICE_ACCOUNT_CREDENTIALS_JSON {{ tb_secret("GCS_SERVICE_ACCOUNT_CREDENTIALS_JSON") }}'
      );
    });

    it("generates DynamoDB connection with arn and region", () => {
      const conn = defineDynamoDBConnection("my_dynamo", {
        region: "us-east-1",
        arn: '{{ tb_secret("DYNAMODB_ROLE_ARN") }}',
      });

      const result = generateConnection(conn);

      expect(result.name).toBe("my_dynamo");
      expect(result.content).toBe(
        ['TYPE dynamodb', 'DYNAMODB_ARN {{ tb_secret("DYNAMODB_ROLE_ARN") }}', "DYNAMODB_REGION us-east-1"].join(
          "\n"
        )
      );
    });
  });

  describe("generateAllConnections", () => {
    it("generates all connections", () => {
      const conn1 = defineKafkaConnection("kafka1", {
        bootstrapServers: "kafka1.example.com:9092",
      });
      const conn2 = defineS3Connection("s3_logs", {
        region: "us-east-1",
        arn: "arn:aws:iam::123456789012:role/tinybird-s3-access",
      });
      const conn3 = defineGCSConnection("gcs_landing", {
        serviceAccountCredentialsJson: '{{ tb_secret("GCS_SERVICE_ACCOUNT_CREDENTIALS_JSON") }}',
      });

      const results = generateAllConnections({
        kafka1: conn1,
        s3_logs: conn2,
        gcs_landing: conn3,
      });

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.name).sort()).toEqual(["gcs_landing", "kafka1", "s3_logs"]);
    });

    it("returns empty array for empty connections", () => {
      const results = generateAllConnections({});

      expect(results).toHaveLength(0);
    });
  });
});
