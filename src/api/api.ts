import { createTinybirdFetcher, type TinybirdFetch } from "./fetcher.js";
import type {
  AppendOptions,
  AppendResult,
  DeleteOptions,
  DeleteResult,
  IngestOptions,
  IngestResult,
  QueryOptions,
  QueryResult,
  TruncateOptions,
  TruncateResult,
  TinybirdErrorResponse,
} from "../client/types.js";

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_INGEST_RETRY_503_BASE_DELAY_MS = 200;
const DEFAULT_INGEST_RETRY_503_MAX_DELAY_MS = 3000;

/**
 * Serialize a single query-param value for the Tinybird pipes API.
 * Plain objects (e.g. p.json() params) become JSON strings; Dates are rejected;
 * everything else uses String(value).
 */
function serializeQueryParamValue(key: string, value: unknown): string {
  if (value instanceof Date) {
    throw new Error(
      `Date values are not supported for query parameter "${key}". ` +
        "Pass a string in YYYY-MM-DD HH:MM:SS format (or YYYY-MM-DD HH:MM:SS.sss for DateTime64)."
    );
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Public, decoupled Tinybird API wrapper configuration
 */
export interface TinybirdApiConfig {
  /** Tinybird API base URL (e.g. https://api.tinybird.co) */
  baseUrl: string;
  /** Tinybird token used for Authorization bearer header */
  token: string;
  /** Custom fetch implementation (optional) */
  fetch?: typeof fetch;
  /** Default timeout in milliseconds (optional) */
  timeout?: number;
}

/**
 * Request options for the API layer
 */
export interface TinybirdApiRequestInit extends RequestInit {
  /** Optional token override for a specific request */
  token?: string;
}

export interface TinybirdApiQueryOptions extends QueryOptions {
  /** Optional token override for this request */
  token?: string;
}

export interface TinybirdApiIngestOptions extends IngestOptions {
  /** Optional token override for this request */
  token?: string;
}

export interface TinybirdApiAppendOptions extends Omit<AppendOptions, 'url' | 'file'> {
  /** Optional token override for this request */
  token?: string;
  /** Import mode */
  mode?: "append" | "replace";
}

export interface TinybirdApiDeleteOptions extends Omit<DeleteOptions, 'deleteCondition'> {
  /** Optional token override for this request */
  token?: string;
}

export interface TinybirdApiTruncateOptions extends TruncateOptions {
  /** Optional token override for this request */
  token?: string;
}

/**
 * Scope definition for token creation APIs
 */
export interface TinybirdApiTokenScope {
  type: string;
  resource?: string;
  fixed_params?: Record<string, string | number | boolean>;
  filter?: string;
}

/**
 * Request body for creating Tinybird tokens.
 * Supports JWT-style scopes and static-token scope strings.
 */
export interface TinybirdApiCreateTokenRequest {
  /** Token name/identifier */
  name: string;
  /** JWT-style scopes */
  scopes?: TinybirdApiTokenScope[];
  /** Static-token scope strings */
  scope?: string | string[];
  /** Optional rate-limiting config */
  limits?: {
    rps?: number;
  };
}

/**
 * Options for token creation requests
 */
export interface TinybirdApiCreateTokenOptions {
  /** Optional expiration time for JWT tokens */
  expirationTime?: number;
  /** Optional token override for this request */
  token?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** AbortController signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Result of token creation
 */
export interface TinybirdApiCreateTokenResult {
  token: string;
}

/**
 * Error thrown by TinybirdApi when a response is not OK
 */
export class TinybirdApiError extends Error {
  readonly statusCode: number;
  readonly responseBody?: string;
  readonly response?: TinybirdErrorResponse;

  constructor(
    message: string,
    statusCode: number,
    responseBody?: string,
    response?: TinybirdErrorResponse
  ) {
    super(message);
    this.name = "TinybirdApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.response = response;
  }
}

/**
 * Low-level Tinybird API wrapper.
 *
 * This layer is intentionally decoupled from the typed TinybirdClient layer
 * so it can be used standalone with just baseUrl + token.
 */
export class TinybirdApi {
  private readonly config: TinybirdApiConfig;
  private readonly baseUrl: string;
  private readonly defaultToken: string;
  private readonly fetchFn: TinybirdFetch;

  constructor(config: TinybirdApiConfig) {
    if (!config.baseUrl) {
      throw new Error("baseUrl is required");
    }

    if (!config.token) {
      throw new Error("token is required");
    }

    this.config = config;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.defaultToken = config.token;
    this.fetchFn = createTinybirdFetcher(config.fetch ?? globalThis.fetch);
  }

  /**
   * Execute a request against Tinybird API.
   */
  request(path: string, init: TinybirdApiRequestInit = {}): Promise<Response> {
    const { token, headers, ...requestInit } = init;
    const authToken = token ?? this.defaultToken;
    const requestHeaders = new Headers(headers);

    if (!requestHeaders.has("Authorization")) {
      requestHeaders.set("Authorization", `Bearer ${authToken}`);
    }

    return this.fetchFn(this.resolveUrl(path), {
      ...requestInit,
      headers: requestHeaders,
    });
  }

  /**
   * Execute a request and parse JSON response.
   */
  async requestJson<T = unknown>(
    path: string,
    init: TinybirdApiRequestInit = {}
  ): Promise<T> {
    const response = await this.request(path, init);

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    return (await response.json()) as T;
  }

  /**
   * Query a Tinybird endpoint
   */
  async query<T = unknown, P extends Record<string, unknown> = Record<string, unknown>>(
    endpointName: string,
    params: P = {} as P,
    options: TinybirdApiQueryOptions = {}
  ): Promise<QueryResult<T>> {
    const url = new URL(`/v0/pipes/${endpointName}.json`, `${this.baseUrl}/`);

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, serializeQueryParamValue(key, item));
        }
        continue;
      }

      url.searchParams.set(key, serializeQueryParamValue(key, value));
    }

    const response = await this.request(url.toString(), {
      method: "GET",
      token: options.token,
      signal: this.createAbortSignal(options.timeout, options.signal),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    return (await response.json()) as QueryResult<T>;
  }

  /**
   * Ingest a single row into a datasource
   */
  async ingest<T extends Record<string, unknown>>(
    datasourceName: string,
    event: T,
    options: TinybirdApiIngestOptions = {}
  ): Promise<IngestResult> {
    return this.ingestBatch(datasourceName, [event], options);
  }

  /**
   * Ingest a batch of rows into a datasource
   */
  async ingestBatch<T extends Record<string, unknown>>(
    datasourceName: string,
    events: T[],
    options: TinybirdApiIngestOptions = {}
  ): Promise<IngestResult> {
    if (events.length === 0) {
      return { successful_rows: 0, quarantined_rows: 0 };
    }

    const url = new URL("/v0/events", `${this.baseUrl}/`);
    url.searchParams.set("name", datasourceName);

    if (options.wait !== false) {
      url.searchParams.set("wait", "true");
    }

    const ndjson = events
      .map((event) => JSON.stringify(this.serializeEvent(event)))
      .join("\n");
    const signal = this.createAbortSignal(options.timeout, options.signal);
    const maxRetries = this.resolveIngestMaxRetries(options.maxRetries);
    let retryCount = 0;

    while (true) {
      let response: Response;

      try {
        response = await this.request(url.toString(), {
          method: "POST",
          token: options.token,
          headers: {
            "Content-Type": "application/x-ndjson",
          },
          body: ndjson,
          signal,
        });
      } catch (error) {
        throw error;
      }

      if (response.ok) {
        return (await response.json()) as IngestResult;
      }

      const retry429Delay = this.resolveRetry429Delay(response, maxRetries, retryCount);
      if (retry429Delay !== undefined) {
        await this.discardResponseBody(response);
        await this.sleep(retry429Delay, signal);
        retryCount += 1;
        continue;
      }

      const retry503Delay = this.resolveRetry503Delay(response, maxRetries, retryCount);
      if (retry503Delay !== undefined) {
        await this.discardResponseBody(response);
        await this.sleep(retry503Delay, signal);
        retryCount += 1;
        continue;
      }

      await this.handleErrorResponse(response);
    }
  }

  /**
   * Execute raw SQL against Tinybird
   */
  async sql<T = unknown>(
    sql: string,
    options: TinybirdApiQueryOptions = {}
  ): Promise<QueryResult<T>> {
    const response = await this.request("/v0/sql", {
      method: "POST",
      token: options.token,
      headers: {
        "Content-Type": "text/plain",
      },
      body: sql,
      signal: this.createAbortSignal(options.timeout, options.signal),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    return (await response.json()) as QueryResult<T>;
  }

  /**
   * Append data to a datasource from a URL or local file
   */
  async appendDatasource(
    datasourceName: string,
    options: AppendOptions,
    apiOptions: TinybirdApiAppendOptions = {}
  ): Promise<AppendResult> {
    const { url: sourceUrl, file: filePath } = options;

    if (!sourceUrl && !filePath) {
      throw new Error("Either 'url' or 'file' must be provided in options");
    }

    if (sourceUrl && filePath) {
      throw new Error("Only one of 'url' or 'file' can be provided, not both");
    }

    const url = new URL("/v0/datasources", `${this.baseUrl}/`);
    url.searchParams.set("name", datasourceName);
    url.searchParams.set("mode", apiOptions.mode ?? "append");

    // Auto-detect format from file/url extension
    const format = this.detectFormat(sourceUrl ?? filePath!);
    if (format) {
      url.searchParams.set("format", format);
    }

    // Add CSV dialect options if applicable
    if (options.csvDialect) {
      if (options.csvDialect.delimiter) {
        url.searchParams.set("dialect_delimiter", options.csvDialect.delimiter);
      }
      if (options.csvDialect.newLine) {
        url.searchParams.set("dialect_new_line", options.csvDialect.newLine);
      }
      if (options.csvDialect.escapeChar) {
        url.searchParams.set("dialect_escapechar", options.csvDialect.escapeChar);
      }
    }

    let response: Response;

    if (sourceUrl) {
      // Remote URL: send as form-urlencoded with url parameter
      response = await this.request(url.toString(), {
        method: "POST",
        token: apiOptions.token,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `url=${encodeURIComponent(sourceUrl)}`,
        signal: this.createAbortSignal(options.timeout ?? apiOptions.timeout, options.signal ?? apiOptions.signal),
      });
    } else {
      // Local file: send as multipart form data
      const formData = await this.createFileFormData(filePath!);
      response = await this.request(url.toString(), {
        method: "POST",
        token: apiOptions.token,
        body: formData,
        signal: this.createAbortSignal(options.timeout ?? apiOptions.timeout, options.signal ?? apiOptions.signal),
      });
    }

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    return (await response.json()) as AppendResult;
  }

  /**
   * Delete rows from a datasource using a SQL condition
   */
  async deleteDatasource(
    datasourceName: string,
    options: DeleteOptions,
    apiOptions: TinybirdApiDeleteOptions = {}
  ): Promise<DeleteResult> {
    const deleteCondition = options.deleteCondition?.trim();

    if (!deleteCondition) {
      throw new Error("'deleteCondition' must be provided in options");
    }

    const url = new URL(
      `/v0/datasources/${encodeURIComponent(datasourceName)}/delete`,
      `${this.baseUrl}/`
    );

    const requestBody = new URLSearchParams();
    requestBody.set("delete_condition", deleteCondition);

    const dryRun = options.dryRun ?? apiOptions.dryRun;
    if (dryRun !== undefined) {
      requestBody.set("dry_run", String(dryRun));
    }

    const response = await this.request(url.toString(), {
      method: "POST",
      token: apiOptions.token,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: requestBody.toString(),
      signal: this.createAbortSignal(
        options.timeout ?? apiOptions.timeout,
        options.signal ?? apiOptions.signal
      ),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    return (await response.json()) as DeleteResult;
  }

  /**
   * Truncate all rows from a datasource
   */
  async truncateDatasource(
    datasourceName: string,
    options: TruncateOptions = {},
    apiOptions: TinybirdApiTruncateOptions = {}
  ): Promise<TruncateResult> {
    const url = new URL(
      `/v0/datasources/${encodeURIComponent(datasourceName)}/truncate`,
      `${this.baseUrl}/`
    );

    const response = await this.request(url.toString(), {
      method: "POST",
      token: apiOptions.token,
      signal: this.createAbortSignal(
        options.timeout ?? apiOptions.timeout,
        options.signal ?? apiOptions.signal
      ),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    return this.parseOptionalJson(response);
  }

  /**
   * Create a token using Tinybird Token API.
   * Supports both static and JWT token payloads.
   */
  async createToken(
    body: TinybirdApiCreateTokenRequest,
    options: TinybirdApiCreateTokenOptions = {}
  ): Promise<TinybirdApiCreateTokenResult> {
    const url = new URL("/v0/tokens/", `${this.baseUrl}/`);

    if (options.expirationTime !== undefined) {
      url.searchParams.set("expiration_time", String(options.expirationTime));
    }

    const response = await this.request(url.toString(), {
      method: "POST",
      token: options.token,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: this.createAbortSignal(options.timeout, options.signal),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    return (await response.json()) as TinybirdApiCreateTokenResult;
  }

  /**
   * Detect format from file path or URL extension
   */
  private detectFormat(source: string): "csv" | "ndjson" | "parquet" | undefined {
    // Remove query string if present
    const pathOnly = source.split("?")[0];
    const extension = pathOnly.split(".").pop()?.toLowerCase();

    switch (extension) {
      case "csv":
        return "csv";
      case "ndjson":
      case "jsonl":
        return "ndjson";
      case "parquet":
        return "parquet";
      default:
        return undefined;
    }
  }

  /**
   * Create FormData for file upload
   */
  private async createFileFormData(filePath: string): Promise<FormData> {
    // Dynamic import for Node.js fs module (browser-safe)
    const fs = await import("node:fs");
    const path = await import("node:path");

    const fileContent = await fs.promises.readFile(filePath);
    const fileName = path.basename(filePath);

    const formData = new FormData();
    formData.append("csv", new Blob([fileContent]), fileName);

    return formData;
  }

  private async parseOptionalJson<T extends object>(response: Response): Promise<T> {
    const rawBody = await response.text();

    if (!rawBody.trim()) {
      return {} as T;
    }

    try {
      return JSON.parse(rawBody) as T;
    } catch {
      return {} as T;
    }
  }

  private createAbortSignal(
    timeout?: number,
    existingSignal?: AbortSignal
  ): AbortSignal | undefined {
    const timeoutMs = timeout ?? this.config.timeout ?? DEFAULT_TIMEOUT;

    if (!timeoutMs && !existingSignal) {
      return undefined;
    }

    if (!timeoutMs && existingSignal) {
      return existingSignal;
    }

    const timeoutSignal = AbortSignal.timeout(timeoutMs);

    if (!existingSignal) {
      return timeoutSignal;
    }

    return AbortSignal.any([timeoutSignal, existingSignal]);
  }

  private resolveIngestMaxRetries(
    maxRetries: TinybirdApiIngestOptions["maxRetries"]
  ): number | undefined {
    if (maxRetries === undefined) {
      return undefined;
    }

    if (!Number.isFinite(maxRetries)) {
      throw new Error("'maxRetries' must be a finite number");
    }

    return Math.max(0, Math.floor(maxRetries));
  }

  private resolveRetry429Delay(
    response: Response,
    maxRetries: number | undefined,
    retryCount: number
  ): number | undefined {
    if (maxRetries === undefined) {
      return undefined;
    }

    if (response.status !== 429) {
      return undefined;
    }

    if (retryCount >= maxRetries) {
      return undefined;
    }

    return this.resolveRetryDelayFromHeaders(response);
  }

  private resolveRetry503Delay(
    response: Response,
    maxRetries: number | undefined,
    retryCount: number
  ): number | undefined {
    if (maxRetries === undefined) {
      return undefined;
    }

    if (response.status !== 503) {
      return undefined;
    }

    if (retryCount >= maxRetries) {
      return undefined;
    }

    return this.calculateRetry503DelayMs(retryCount);
  }

  private resolveRetryDelayFromHeaders(response: Response): number | undefined {
    const retryAfter = response.headers.get("retry-after");
    const retryAfterDelay = this.parseRetryAfterDelayMs(retryAfter);
    if (retryAfterDelay !== undefined) {
      return retryAfterDelay;
    }

    const rateLimitReset = response.headers.get("x-ratelimit-reset");
    const rateLimitResetDelay = this.parseRateLimitResetDelayMs(rateLimitReset);
    if (rateLimitResetDelay !== undefined) {
      return rateLimitResetDelay;
    }
    return undefined;
  }

  private parseRetryAfterDelayMs(value: string | null): number | undefined {
    if (!value) {
      return undefined;
    }

    const trimmed = value.trim();
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds)) {
      return Math.max(0, Math.floor(seconds * 1000));
    }

    const retryDateMs = Date.parse(trimmed);
    if (Number.isNaN(retryDateMs)) {
      return undefined;
    }

    return Math.max(0, retryDateMs - Date.now());
  }

  private parseRateLimitResetDelayMs(value: string | null): number | undefined {
    if (!value) {
      return undefined;
    }

    const numericValue = Number(value.trim());
    if (!Number.isFinite(numericValue)) {
      return undefined;
    }

    return Math.max(0, Math.floor(numericValue * 1000));
  }

  private calculateRetry503DelayMs(retryCount: number): number {
    return Math.min(
      DEFAULT_INGEST_RETRY_503_MAX_DELAY_MS,
      DEFAULT_INGEST_RETRY_503_BASE_DELAY_MS * 2 ** retryCount
    );
  }

  private async discardResponseBody(response: Response): Promise<void> {
    if (response.bodyUsed || !response.body) {
      return;
    }

    try {
      await response.arrayBuffer();
    } catch {
      try {
        await response.body.cancel();
      } catch {
        // Best effort cleanup only; never mask retry/error flow.
      }
    }
  }

  private async sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (delayMs <= 0) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, delayMs);

      const onAbort = () => {
        cleanup();
        reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
      };

      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };

      if (!signal) {
        return;
      }

      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private serializeEvent(
    event: Record<string, unknown>
  ): Record<string, unknown> {
    const serialized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(event)) {
      serialized[key] = this.serializeValue(value);
    }

    return serialized;
  }

  private serializeValue(value: unknown): unknown {
    if (value instanceof Date) {
      throw new Error(
        "Date values are not supported in ingest payloads. " +
          "Pass strings in YYYY-MM-DD, YYYY-MM-DD HH:MM:SS, or YYYY-MM-DD HH:MM:SS.sss format."
      );
    }

    if (value instanceof Map) {
      return Object.fromEntries(value);
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.serializeValue(item));
    }

    if (typeof value === "object" && value !== null) {
      return this.serializeEvent(value as Record<string, unknown>);
    }

    return value;
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    const rawBody = await response.text();
    let errorResponse: TinybirdErrorResponse | undefined;

    try {
      errorResponse = JSON.parse(rawBody) as TinybirdErrorResponse;
    } catch {
      // ignore parse error and keep raw body
    }

    const message =
      errorResponse?.error ??
      (rawBody
        ? `Request failed with status ${response.status}: ${rawBody}`
        : `Request failed with status ${response.status}`);

    throw new TinybirdApiError(
      message,
      response.status,
      rawBody || undefined,
      errorResponse
    );
  }

  private resolveUrl(path: string): string {
    return new URL(path, `${this.baseUrl}/`).toString();
  }
}

/**
 * Create a decoupled Tinybird API wrapper.
 */
export function createTinybirdApi(
  config: TinybirdApiConfig
): TinybirdApi {
  return new TinybirdApi(config);
}

/**
 * Alias for teams that prefer "wrapper" naming.
 */
export const createTinybirdApiWrapper = createTinybirdApi;
