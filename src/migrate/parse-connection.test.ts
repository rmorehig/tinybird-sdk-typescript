import { describe, it, expect } from "vitest";
import { parseConnectionFile } from "./parse-connection.js";
import type { ResourceFile } from "./types.js";

function resource(name: string, content: string): ResourceFile {
  return {
    kind: "connection",
    name,
    filePath: `${name}.connection`,
    absolutePath: `/tmp/${name}.connection`,
    content,
  };
}

describe("parseConnectionFile", () => {
  it("parses basic Kafka connection", () => {
    const result = parseConnectionFile(
      resource(
        "my_kafka",
        `TYPE kafka
KAFKA_BOOTSTRAP_SERVERS localhost:9092`
      )
    );

    expect(result.connectionType).toBe("kafka");
    expect(result).toHaveProperty("bootstrapServers", "localhost:9092");
  });

  it("parses single-quoted TYPE", () => {
    const result = parseConnectionFile(
      resource(
        "my_kafka",
        `TYPE 'kafka'
KAFKA_BOOTSTRAP_SERVERS localhost:9092
KAFKA_SCHEMA_REGISTRY_URL https://registry.example.com`
      )
    );

    expect(result.connectionType).toBe("kafka");
    expect(result).toHaveProperty("schemaRegistryUrl", "https://registry.example.com");
  });

  it("parses multiline SSL CA PEM with > syntax", () => {
    const result = parseConnectionFile(
      resource(
        "my_kafka",
        `TYPE kafka
KAFKA_BOOTSTRAP_SERVERS localhost:9092
KAFKA_SECURITY_PROTOCOL SASL_SSL
KAFKA_SSL_CA_PEM >
    -----BEGIN CERTIFICATE-----
    MIIDXTCCAkWgAwIBAgIJAM
    -----END CERTIFICATE-----`
      )
    );

    expect(result).toHaveProperty(
      "sslCaPem",
      "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAM\n-----END CERTIFICATE-----"
    );
  });

  it("parses multiline SSL CA PEM with directives after the block", () => {
    const result = parseConnectionFile(
      resource(
        "my_kafka",
        `TYPE kafka
KAFKA_BOOTSTRAP_SERVERS localhost:9092
KAFKA_SSL_CA_PEM >
    -----BEGIN CERTIFICATE-----
    MIIDXTCCAkWgAwIBAgIJAM
    -----END CERTIFICATE-----
KAFKA_SECURITY_PROTOCOL SASL_SSL
KAFKA_KEY mykey`
      )
    );

    expect(result).toHaveProperty(
      "sslCaPem",
      "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAM\n-----END CERTIFICATE-----"
    );
    expect(result).toHaveProperty("securityProtocol", "SASL_SSL");
    expect(result).toHaveProperty("key", "mykey");
  });

  it("parses single-line SSL CA PEM (e.g. a secret reference)", () => {
    const result = parseConnectionFile(
      resource(
        "my_kafka",
        `TYPE kafka
KAFKA_BOOTSTRAP_SERVERS localhost:9092
KAFKA_SSL_CA_PEM {{ tb_secret('KAFKA_SSL_CA_PEM') }}`
      )
    );

    expect(result).toHaveProperty("sslCaPem", "{{ tb_secret('KAFKA_SSL_CA_PEM') }}");
  });

  it("parses Kafka AWS IAM OAUTHBEARER directives", () => {
    const result = parseConnectionFile(
      resource(
        "aws_msk",
        `TYPE kafka
KAFKA_BOOTSTRAP_SERVERS b-1.msk.example.com:9098,b-2.msk.example.com:9098
KAFKA_SECURITY_PROTOCOL SASL_SSL
KAFKA_SASL_MECHANISM OAUTHBEARER
KAFKA_SASL_OAUTHBEARER_METHOD AWS
KAFKA_SASL_OAUTHBEARER_AWS_REGION eu-west-1
KAFKA_SASL_OAUTHBEARER_AWS_ROLE_ARN {{ tb_secret("KAFKA_AWS_ROLE_ARN") }}
KAFKA_SASL_OAUTHBEARER_AWS_EXTERNAL_ID {{ tb_secret("KAFKA_AWS_EXTERNAL_ID") }}`
      )
    );

    expect(result).toHaveProperty("saslOauthbearerMethod", "AWS");
    expect(result).toHaveProperty("saslOauthbearerAwsRegion", "eu-west-1");
    expect(result).toHaveProperty(
      "saslOauthbearerAwsRoleArn",
      '{{ tb_secret("KAFKA_AWS_ROLE_ARN") }}'
    );
    expect(result).toHaveProperty(
      "saslOauthbearerAwsExternalId",
      '{{ tb_secret("KAFKA_AWS_EXTERNAL_ID") }}'
    );
  });

  it("parses basic DynamoDB connection", () => {
    const result = parseConnectionFile(
      resource(
        "my_dynamo",
        `TYPE dynamodb
DYNAMODB_ARN {{ tb_secret("DYNAMODB_ROLE_ARN") }}
DYNAMODB_REGION us-east-1`
      )
    );

    expect(result.connectionType).toBe("dynamodb");
    expect(result).toHaveProperty("arn", '{{ tb_secret("DYNAMODB_ROLE_ARN") }}');
    expect(result).toHaveProperty("region", "us-east-1");
  });

  it("throws when DynamoDB connection is missing DYNAMODB_ARN", () => {
    expect(() =>
      parseConnectionFile(
        resource(
          "my_dynamo",
          `TYPE dynamodb
DYNAMODB_REGION us-east-1`
        )
      )
    ).toThrow("DYNAMODB_ARN is required");
  });

  it("throws when DynamoDB connection mixes S3 directives", () => {
    expect(() =>
      parseConnectionFile(
        resource(
          "my_dynamo",
          `TYPE dynamodb
DYNAMODB_ARN {{ tb_secret("DYNAMODB_ROLE_ARN") }}
DYNAMODB_REGION us-east-1
S3_ARN arn:aws:iam::1:role/x`
        )
      )
    ).toThrow("Kafka/S3/GCS directives are not valid for dynamodb connections.");
  });
});
