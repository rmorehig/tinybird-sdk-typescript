export type ResourceKind = "datasource" | "pipe" | "connection";

export interface ResourceFile {
  kind: ResourceKind;
  filePath: string;
  absolutePath: string;
  name: string;
  content: string;
}

export interface MigrationError {
  filePath: string;
  resourceName: string;
  resourceKind: ResourceKind;
  message: string;
}

export interface DatasourceColumnModel {
  name: string;
  type: string;
  jsonPath?: string;
  defaultExpression?: string;
  codec?: string;
}

export interface DatasourceEngineModel {
  type: string;
  sortingKey: string[];
  partitionKey?: string;
  primaryKey?: string[];
  ttl?: string;
  ver?: string;
  isDeleted?: string;
  sign?: string;
  version?: string;
  summingColumns?: string[];
  settings?: Record<string, string | number | boolean>;
}

export interface DatasourceKafkaModel {
  connectionName: string;
  topic: string;
  groupId?: string;
  autoOffsetReset?: "earliest" | "latest";
  storeRawValue?: boolean;
}

export interface DatasourceS3Model {
  connectionName: string;
  bucketUri: string;
  schedule?: string;
  fromTimestamp?: string;
}

export interface DatasourceGCSModel {
  connectionName: string;
  bucketUri: string;
  schedule?: string;
  fromTimestamp?: string;
}

export interface DatasourceDynamoDBModel {
  connectionName: string;
  tableArn: string;
  exportBucket: string;
}

export interface DatasourceTokenModel {
  name: string;
  scope: "READ" | "APPEND";
}

export interface DatasourceIndexModel {
  name: string;
  expr: string;
  type: string;
  granularity: number;
}

export interface DatasourceModel {
  kind: "datasource";
  name: string;
  filePath: string;
  description?: string;
  columns: DatasourceColumnModel[];
  engine?: DatasourceEngineModel;
  indexes: DatasourceIndexModel[];
  kafka?: DatasourceKafkaModel;
  s3?: DatasourceS3Model;
  gcs?: DatasourceGCSModel;
  dynamodb?: DatasourceDynamoDBModel;
  forwardQuery?: string;
  tokens: DatasourceTokenModel[];
  sharedWith: string[];
}

export interface PipeNodeModel {
  name: string;
  description?: string;
  sql: string;
}

export interface PipeTokenModel {
  name: string;
  scope: "READ";
}

export type PipeTypeModel = "pipe" | "endpoint" | "materialized" | "copy" | "sink";

export interface PipeKafkaSinkModel {
  service: "kafka";
  connectionName: string;
  topic: string;
  schedule: string;
}

export interface PipeS3SinkModel {
  service: "s3";
  connectionName: string;
  bucketUri: string;
  fileTemplate: string;
  format: string;
  schedule: string;
  strategy?: "create_new" | "replace";
  compression?: "none" | "gzip" | "snappy";
}

export type PipeSinkModel = PipeKafkaSinkModel | PipeS3SinkModel;

export interface PipeParamModel {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string | number | boolean;
  description?: string;
}

export interface PipeModel {
  kind: "pipe";
  name: string;
  filePath: string;
  description?: string;
  type: PipeTypeModel;
  nodes: PipeNodeModel[];
  cacheTtl?: number;
  materializedDatasource?: string;
  deploymentMethod?: "alter";
  copyTargetDatasource?: string;
  copySchedule?: string;
  copyMode?: "append" | "replace";
  sink?: PipeSinkModel;
  tokens: PipeTokenModel[];
  params: PipeParamModel[];
  inferredOutputColumns: string[];
}

export interface KafkaConnectionModel {
  kind: "connection";
  name: string;
  filePath: string;
  connectionType: "kafka";
  bootstrapServers: string;
  securityProtocol?: "SASL_SSL" | "PLAINTEXT" | "SASL_PLAINTEXT";
  saslMechanism?: "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512" | "OAUTHBEARER";
  saslOauthbearerMethod?: "AWS";
  saslOauthbearerAwsRegion?: string;
  saslOauthbearerAwsRoleArn?: string;
  saslOauthbearerAwsExternalId?: string;
  key?: string;
  secret?: string;
  schemaRegistryUrl?: string;
  sslCaPem?: string;
}

export interface S3ConnectionModel {
  kind: "connection";
  name: string;
  filePath: string;
  connectionType: "s3";
  region: string;
  arn?: string;
  accessKey?: string;
  secret?: string;
}

export interface GCSConnectionModel {
  kind: "connection";
  name: string;
  filePath: string;
  connectionType: "gcs";
  serviceAccountCredentialsJson: string;
}

export interface DynamoDBConnectionModel {
  kind: "connection";
  name: string;
  filePath: string;
  connectionType: "dynamodb";
  region: string;
  arn: string;
}

export type ParsedResource =
  | DatasourceModel
  | PipeModel
  | KafkaConnectionModel
  | S3ConnectionModel
  | GCSConnectionModel
  | DynamoDBConnectionModel;

export interface MigrationResult {
  success: boolean;
  outputPath: string;
  migrated: ParsedResource[];
  errors: MigrationError[];
  dryRun: boolean;
  outputContent?: string;
}
