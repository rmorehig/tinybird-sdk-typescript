/**
 * Configuration types for tinybird.config.{ts,js,json}
 *
 * This file is separate from config.ts to avoid pulling in esbuild
 * when these types are imported by client code.
 */

/**
 * Development mode options
 * - "branch": Use Tinybird cloud with branches (default)
 * - "local": Use local Tinybird container at localhost:7181
 */
export type DevMode = "branch" | "local";
export enum BranchDataOnCreate {
  LAST_PARTITION = "last_partition",
  ALL_PARTITIONS = "all_partitions",
}

/**
 * Tinybird configuration file structure
 */
export interface TinybirdConfig {
  /** Array of file paths or glob patterns to scan for TypeScript/resources */
  include?: string[];
  /** @deprecated Use `include` instead. Path to the TypeScript schema entry point */
  schema?: string;
  /** API token (supports ${ENV_VAR} interpolation) */
  token: string;
  /** Tinybird API base URL (optional, defaults to EU region) */
  baseUrl?: string;
  /** Development mode: "branch" (default) or "local" */
  devMode?: DevMode;
  /** Branch data mode applied on cloud branch creation (shared snake_case key) */
  branch_data_on_create?: BranchDataOnCreate;
}
