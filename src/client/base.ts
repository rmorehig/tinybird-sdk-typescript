/**
 * Tinybird client for querying pipes and ingesting events
 */

import type {
  AppendOptions,
  AppendResult,
  ClientConfig,
  ClientContext,
  DatasourcesNamespace,
  DeleteOptions,
  DeleteResult,
  QueryResult,
  IngestResult,
  QueryOptions,
  IngestOptions,
  TruncateOptions,
  TruncateResult,
} from "./types.js";
import { TinybirdError } from "./types.js";
import { TinybirdApi, TinybirdApiError } from "../api/api.js";
import { TokensNamespace } from "./tokens.js";

/**
 * Resolved token info from dev mode
 */
interface ResolvedTokenInfo {
  token: string;
  isBranchToken: boolean;
  branchName?: string;
  gitBranch?: string;
}

/**
 * Tinybird API client
 *
 * Provides methods for querying pipe endpoints and ingesting events to datasources.
 *
 * @example
 * ```ts
 * import { TinybirdClient } from '@tinybirdco/sdk';
 *
 * const client = new TinybirdClient({
 *   baseUrl: 'https://api.tinybird.co',
 *   token: process.env.TINYBIRD_TOKEN,
 * });
 *
 * // Query a pipe
 * const result = await client.query('top_events', {
 *   start_date: '2024-01-01',
 *   end_date: '2024-01-31',
 * });
 *
 * // Ingest an event
 * await client.ingest('events', {
 *   timestamp: '2024-01-15 10:30:00',
 *   event_type: 'page_view',
 *   user_id: 'user_123',
 * });
 * ```
 */
export class TinybirdClient {
  private readonly config: ClientConfig;
  private readonly apisByToken = new Map<string, TinybirdApi>();
  private contextPromise: Promise<ClientContext> | null = null;
  private resolvedContext: ClientContext | null = null;

  /**
   * Datasources namespace for ingest and import operations
   */
  readonly datasources: DatasourcesNamespace;

  /** Token operations (JWT creation, etc.) */
  public readonly tokens: TokensNamespace;

  constructor(config: ClientConfig) {
    // Validate required config
    if (!config.baseUrl) {
      throw new Error("baseUrl is required");
    }
    if (!config.token) {
      throw new Error("token is required");
    }

    // Normalize base URL (remove trailing slash)
    this.config = {
      ...config,
      baseUrl: config.baseUrl.replace(/\/$/, ""),
    };

    // Initialize datasources namespace
    this.datasources = {
      ingest: <T extends Record<string, unknown>>(
        datasourceName: string,
        event: T,
        options: IngestOptions = {}
      ): Promise<IngestResult> => {
        return this.ingestDatasource(datasourceName, event, options);
      },
      append: (datasourceName: string, options: AppendOptions): Promise<AppendResult> => {
        return this.appendDatasource(datasourceName, options);
      },
      replace: (datasourceName: string, options: AppendOptions): Promise<AppendResult> => {
        return this.replaceDatasource(datasourceName, options);
      },
      delete: (datasourceName: string, options: DeleteOptions): Promise<DeleteResult> => {
        return this.deleteDatasource(datasourceName, options);
      },
      truncate: (
        datasourceName: string,
        options: TruncateOptions = {}
      ): Promise<TruncateResult> => {
        return this.truncateDatasource(datasourceName, options);
      },
    };

    // Initialize tokens namespace
    this.tokens = new TokensNamespace(
      () => this.getToken(),
      this.config.baseUrl,
      this.config.fetch,
      this.config.timeout
    );
  }

  /**
   * Append data to a datasource from a URL or local file
   *
   * @param datasourceName - Name of the datasource
   * @param options - Append options including url or file source
   * @returns Append result
   *
   * @example
   * ```ts
   * // Append from URL
   * await client.datasources.append('events', {
   *   url: 'https://example.com/data.csv',
   * });
   *
   * // Append from local file
   * await client.datasources.append('events', {
   *   file: './data/events.ndjson',
   * });
   * ```
   */
  private async appendDatasource(
    datasourceName: string,
    options: AppendOptions
  ): Promise<AppendResult> {
    const token = await this.getToken();

    try {
      return await this.getApi(token).appendDatasource(datasourceName, options);
    } catch (error) {
      this.rethrowApiError(error);
    }
  }

  /**
   * Replace datasource rows from a URL or local file
   *
   * @param datasourceName - Name of the datasource
   * @param options - Replace options including url or file source
   * @returns Append-style result
   */
  private async replaceDatasource(
    datasourceName: string,
    options: AppendOptions
  ): Promise<AppendResult> {
    const token = await this.getToken();

    try {
      return await this.getApi(token).appendDatasource(datasourceName, options, {
        mode: "replace",
      });
    } catch (error) {
      this.rethrowApiError(error);
    }
  }

  /**
   * Delete rows from a datasource using a SQL condition
   *
   * @param datasourceName - Name of the datasource
   * @param options - Delete options including deleteCondition
   * @returns Delete job result
   */
  private async deleteDatasource(
    datasourceName: string,
    options: DeleteOptions
  ): Promise<DeleteResult> {
    const token = await this.getToken();

    try {
      return await this.getApi(token).deleteDatasource(datasourceName, options);
    } catch (error) {
      this.rethrowApiError(error);
    }
  }

  /**
   * Truncate all rows from a datasource
   *
   * @param datasourceName - Name of the datasource
   * @param options - Truncate options
   * @returns Truncate result
   */
  private async truncateDatasource(
    datasourceName: string,
    options: TruncateOptions = {}
  ): Promise<TruncateResult> {
    const token = await this.getToken();

    try {
      return await this.getApi(token).truncateDatasource(datasourceName, options);
    } catch (error) {
      this.rethrowApiError(error);
    }
  }

  /**
   * Ingest a single event to a datasource
   *
   * @param datasourceName - Name of the datasource
   * @param event - Event data to ingest
   * @param options - Additional request options
   * @returns Ingest result
   */
  private async ingestDatasource<T extends Record<string, unknown>>(
    datasourceName: string,
    event: T,
    options: IngestOptions = {}
  ): Promise<IngestResult> {
    const token = await this.getToken();

    try {
      return await this.getApi(token).ingestBatch(datasourceName, [event], options);
    } catch (error) {
      this.rethrowApiError(error);
    }
  }

  /**
   * Get the effective token, resolving branch token in dev mode if needed
   */
  private async getToken(): Promise<string> {
    const context = await this.resolveContext();
    return context.token;
  }

  /**
   * Resolve the client context, including branch token resolution in dev mode
   * This is the single source of truth for all context data
   */
  private async resolveContext(): Promise<ClientContext> {
    // If already resolved, return it
    if (this.resolvedContext) {
      return this.resolvedContext;
    }

    // If not in dev mode, use the configured token
    if (!this.config.devMode) {
      this.resolvedContext = this.buildContext({
        token: this.config.token,
        isBranchToken: false,
      });
      return this.resolvedContext;
    }

    // In dev mode, lazily resolve the branch token
    if (!this.contextPromise) {
      this.contextPromise = this.resolveBranchContext();
    }

    this.resolvedContext = await this.contextPromise;
    return this.resolvedContext;
  }

  /**
   * Build the client context from resolved token info
   */
  private buildContext(tokenInfo: ResolvedTokenInfo): ClientContext {
    return {
      token: tokenInfo.token,
      baseUrl: this.config.baseUrl,
      devMode: this.config.devMode ?? false,
      isBranchToken: tokenInfo.isBranchToken,
      branchName: tokenInfo.branchName ?? null,
      gitBranch: tokenInfo.gitBranch ?? null,
    };
  }

  /**
   * Resolve the branch context in dev mode
   */
  private async resolveBranchContext(): Promise<ClientContext> {
    try {
      // Dynamic import to avoid circular dependencies and to keep CLI code
      // out of the client bundle when not using dev mode
      const { loadConfigAsync } = await import("../cli/config.js");
      const { getOrCreateBranch } = await import("../api/branches.js");
      const { BranchDataMode } = await import("../cli/config-types.js");
      const { isPreviewEnvironment, getPreviewBranchName } = await import(
        "./preview.js"
      );

      // In preview environments (Vercel preview, CI), the token was already resolved
      // by resolveToken() in project.ts - skip branch creation to avoid conflicts
      if (isPreviewEnvironment()) {
        const gitBranchName = getPreviewBranchName();
        // Preview branches use the tmp_ci_ prefix (matches what tinybird preview creates)
        const sanitized = gitBranchName
          ? gitBranchName
              .replace(/[^a-zA-Z0-9_]/g, "_")
              .replace(/_+/g, "_")
              .replace(/^_|_$/g, "")
          : undefined;
        const tinybirdBranchName = sanitized
          ? `tmp_ci_${sanitized}`
          : undefined;
        return this.buildContext({
          token: this.config.token,
          isBranchToken: !!tinybirdBranchName,
          branchName: tinybirdBranchName,
          gitBranch: gitBranchName ?? undefined,
        });
      }

      // Use configDir if provided (important for monorepo setups where process.cwd()
      // may not be in the same directory tree as tinybird.json)
      const config = await loadConfigAsync(this.config.configDir);
      const gitBranch = config.gitBranch ?? undefined;

      // If on main branch, use the workspace token
      if (config.isMainBranch || !config.tinybirdBranch) {
        return this.buildContext({
          token: this.config.token,
          isBranchToken: false,
          gitBranch,
        });
      }

      const branchName = config.tinybirdBranch;
      const branchOptions =
        config.devMode !== "local" &&
        config.branchDataMode === BranchDataMode.LAST_PARTITION
          ? { lastPartition: true }
          : undefined;

      // Get or create branch (always fetch fresh to avoid stale cache issues)
      const branch = await getOrCreateBranch(
        {
          baseUrl: this.config.baseUrl,
          token: this.config.token,
          fetch: this.config.fetch,
        },
        branchName,
        branchOptions
      );

      if (!branch.token) {
        // Fall back to workspace token if no branch token
        return this.buildContext({
          token: this.config.token,
          isBranchToken: false,
          gitBranch,
        });
      }

      return this.buildContext({
        token: branch.token,
        isBranchToken: true,
        branchName,
        gitBranch,
      });
    } catch (error) {
      throw new TinybirdError(
        `Failed to resolve branch context: ${(error as Error).message}`,
        500
      );
    }
  }

  /**
   * Query a pipe endpoint
   *
   * @param pipeName - Name of the pipe to query
   * @param params - Query parameters
   * @param options - Additional request options
   * @returns Query result with typed data
   */
  async query<T = unknown>(
    pipeName: string,
    params: Record<string, unknown> = {},
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const token = await this.getToken();

    try {
      return await this.getApi(token).query<T>(pipeName, params, options);
    } catch (error) {
      this.rethrowApiError(error);
    }
  }

  /**
   * Ingest a single event to a datasource
   *
   * @param datasourceName - Name of the datasource
   * @param event - Event data to ingest
   * @param options - Additional request options
   * @returns Ingest result
   */
  async ingest<T extends Record<string, unknown>>(
    datasourceName: string,
    event: T,
    options: IngestOptions = {}
  ): Promise<IngestResult> {
    return this.datasources.ingest(datasourceName, event, options);
  }

  /**
   * Ingest multiple events to a datasource
   *
   * @param datasourceName - Name of the datasource
   * @param events - Array of events to ingest
   * @param options - Additional request options
   * @returns Ingest result
   */
  async ingestBatch<T extends Record<string, unknown>>(
    datasourceName: string,
    events: T[],
    options: IngestOptions = {}
  ): Promise<IngestResult> {
    const token = await this.getToken();

    try {
      return await this.getApi(token).ingestBatch(
        datasourceName,
        events,
        options
      );
    } catch (error) {
      this.rethrowApiError(error);
    }
  }

  /**
   * Execute a raw SQL query
   *
   * @param sql - SQL query to execute
   * @param options - Additional request options
   * @returns Query result
   */
  async sql<T = unknown>(
    sql: string,
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const token = await this.getToken();

    try {
      return await this.getApi(token).sql<T>(sql, options);
    } catch (error) {
      this.rethrowApiError(error);
    }
  }

  /**
   * Get the current client context
   *
   * Returns information about the resolved configuration including the token being used,
   * API URL, dev mode status, and branch information.
   *
   * @returns Client context with resolved configuration
   *
   * @example
   * ```ts
   * const client = createClient({
   *   baseUrl: 'https://api.tinybird.co',
   *   token: process.env.TINYBIRD_TOKEN,
   *   devMode: true,
   * });
   *
   * const context = await client.getContext();
   * console.log(context.branchName); // 'feature_my_branch'
   * console.log(context.isBranchToken); // true
   * ```
   */
  async getContext(): Promise<ClientContext> {
    return this.resolveContext();
  }

  private getApi(token: string): TinybirdApi {
    const existing = this.apisByToken.get(token);
    if (existing) {
      return existing;
    }

    const api = new TinybirdApi({
      baseUrl: this.config.baseUrl,
      token,
      fetch: this.config.fetch,
      timeout: this.config.timeout,
    });

    this.apisByToken.set(token, api);
    return api;
  }

  private rethrowApiError(error: unknown): never {
    if (error instanceof TinybirdApiError) {
      throw new TinybirdError(error.message, error.statusCode, error.response);
    }

    throw error;
  }
}

/**
 * Create a Tinybird client
 *
 * @param config - Client configuration
 * @returns Configured Tinybird client
 *
 * @example
 * ```ts
 * import { createClient } from '@tinybirdco/sdk';
 *
 * const client = createClient({
 *   baseUrl: process.env.TINYBIRD_URL,
 *   token: process.env.TINYBIRD_TOKEN,
 * });
 * ```
 */
export function createClient(config: ClientConfig): TinybirdClient {
  return new TinybirdClient(config);
}
