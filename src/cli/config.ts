/**
 * Configuration loader for tinybird.json
 */

import * as fs from "fs";
import * as path from "path";
import { config as loadDotenv } from "dotenv";
import { getCurrentGitBranch, isMainBranch, getTinybirdBranchName } from "./git.js";

// Re-export config types/constants from config-types.ts (separate file to avoid bundling esbuild)
export { BranchDataOnCreate, type DevMode, type TinybirdConfig } from "./config-types.js";
import { BranchDataOnCreate } from "./config-types.js";
import type { DevMode, TinybirdConfig } from "./config-types.js";

/**
 * Resolved configuration with all values expanded
 */
export interface ResolvedConfig {
  /** Array of file paths or glob patterns to scan for datasources and pipes */
  include: string[];
  /** Resolved API token (workspace main token) */
  token: string;
  /** Tinybird API base URL */
  baseUrl: string;
  /** Path to the config file */
  configPath: string;
  /** Working directory */
  cwd: string;
  /** Current git branch (null if not in git repo or detached HEAD) */
  gitBranch: string | null;
  /** Sanitized branch name for Tinybird (symbols replaced with underscores) */
  tinybirdBranch: string | null;
  /** Whether we're on the main/master branch */
  isMainBranch: boolean;
  /** Development mode: "branch" or "local" */
  devMode: DevMode;
  /** Branch data mode configured in tinybird.config.json */
  branchDataOnCreate?: BranchDataOnCreate | null;
}

/**
 * Default base URL (EU region)
 */
const DEFAULT_BASE_URL = "https://api.tinybird.co";

/**
 * Local Tinybird base URL
 */
export const LOCAL_BASE_URL = "http://localhost:7181";

/**
 * Config file names in priority order
 * - tinybird.config.mjs: ESM config with dynamic logic
 * - tinybird.config.cjs: CommonJS config with dynamic logic
 * - tinybird.config.json: Standard JSON config (default for new projects)
 * - tinybird.json: Legacy JSON config (backward compatible)
 */
const CONFIG_FILES = [
  "tinybird.config.mjs",
  "tinybird.config.cjs",
  "tinybird.config.json",
  "tinybird.json",
] as const;

type ConfigFileType = (typeof CONFIG_FILES)[number];

/**
 * Default config file name for new projects
 */
const DEFAULT_CONFIG_FILE = "tinybird.config.json";

/**
 * Tinybird file path within lib folder
 */
const TINYBIRD_FILE = "lib/tinybird.ts";

/**
 * Load .env files from a directory.
 *
 * Priority:
 * 1. .env.local
 * 2. .env
 *
 * Existing process.env values are preserved (dotenv default behavior).
 */
export function loadEnvFiles(directory: string): void {
  const envLocalPath = path.join(directory, ".env.local");
  const envPath = path.join(directory, ".env");

  if (fs.existsSync(envLocalPath)) {
    loadDotenv({ path: envLocalPath });
  }

  if (fs.existsSync(envPath)) {
    loadDotenv({ path: envPath });
  }
}

/**
 * Detect if project has a src folder
 */
export function hasSrcFolder(cwd: string): boolean {
  const srcPath = path.join(cwd, "src");
  return fs.existsSync(srcPath) && fs.statSync(srcPath).isDirectory();
}

/**
 * Get the tinybird file path based on project structure
 * Returns 'src/lib/tinybird.ts' if project has src folder, otherwise 'lib/tinybird.ts'
 */
export function getTinybirdDir(cwd: string): string {
  return hasSrcFolder(cwd)
    ? path.join(cwd, "src", "lib")
    : path.join(cwd, "lib");
}

/**
 * Get the relative tinybird file path based on project structure
 */
export function getRelativeTinybirdDir(cwd: string): string {
  return hasSrcFolder(cwd) ? `src/${TINYBIRD_FILE}` : TINYBIRD_FILE;
}

/**
 * Get the datasources.ts path based on project structure
 */
export function getDatasourcesPath(cwd: string): string {
  return path.join(getTinybirdDir(cwd), "datasources.ts");
}

/**
 * Get the pipes.ts path based on project structure
 */
export function getPipesPath(cwd: string): string {
  return path.join(getTinybirdDir(cwd), "pipes.ts");
}

/**
 * Get the client.ts path based on project structure
 */
export function getClientPath(cwd: string): string {
  return path.join(getTinybirdDir(cwd), "client.ts");
}


/**
 * Interpolate environment variables in a string
 *
 * Supports ${VAR_NAME} syntax
 */
function interpolateEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    const envValue = process.env[envVar];
    if (envValue === undefined) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return envValue;
  });
}

/**
 * Result of finding a config file
 */
export interface ConfigFileResult {
  /** Full path to the config file */
  path: string;
  /** Type of config file found */
  type: ConfigFileType;
}

/**
 * Find the config file by walking up the directory tree
 * Checks for all supported config file names in priority order
 *
 * @param startDir - Directory to start searching from
 * @returns Path and type of the config file, or null if not found
 */
export function findConfigFile(startDir: string): ConfigFileResult | null {
  let currentDir = startDir;

  while (true) {
    // Check each config file type in priority order
    for (const configFile of CONFIG_FILES) {
      const configPath = path.join(currentDir, configFile);
      if (fs.existsSync(configPath)) {
        return { path: configPath, type: configFile };
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached root
      return null;
    }
    currentDir = parentDir;
  }
}

// Import the universal config loader
import { loadConfigFile } from "./config-loader.js";

function resolveBranchDataOnCreate(raw: Record<string, unknown>): BranchDataOnCreate | null {
  const value = raw["branch_data_on_create"];
  if (value === undefined || value === null) return BranchDataOnCreate.LAST_PARTITION;
  if (typeof value !== "string") throw new Error("branch_data_on_create must be a string.");
  const mode = value.trim().toLowerCase();
  if (!mode) return BranchDataOnCreate.LAST_PARTITION;
  if (mode !== BranchDataOnCreate.LAST_PARTITION && mode !== BranchDataOnCreate.ALL_PARTITIONS) {
    throw new Error(`Invalid branch_data_on_create '${value}'. Allowed values are: last_partition, all_partitions.`);
  }
  if (mode === BranchDataOnCreate.ALL_PARTITIONS) {
    throw new Error("branch_data_on_create 'all_partitions' is currently disabled.");
  }
  return mode as BranchDataOnCreate;
}

/**
 * Resolve a TinybirdConfig to a ResolvedConfig
 */
function resolveConfig(config: TinybirdConfig, configPath: string): ResolvedConfig {
  // Validate required fields - need either include or schema
  if (!config.include && !config.schema) {
    throw new Error(`Missing 'include' field in ${configPath}. Add an array of files to scan for datasources and pipes.`);
  }

  if (!config.token) {
    throw new Error(`Missing 'token' field in ${configPath}`);
  }

  // Resolve include paths (support legacy schema field)
  let include: string[];
  if (config.include) {
    include = config.include;
  } else if (config.schema) {
    // Legacy mode: treat schema as a single include path
    include = [config.schema];
  } else {
    // Should never reach here due to validation above
    include = [];
  }

  // Get the directory containing the config file
  const configDir = path.dirname(configPath);

  // Load environment files next to the config before interpolating values.
  loadEnvFiles(configDir);

  // Resolve token (may contain env vars)
  let resolvedToken: string;
  try {
    resolvedToken = interpolateEnvVars(config.token);
  } catch (error) {
    throw new Error(
      `Failed to resolve token in ${configPath}: ${(error as Error).message}`
    );
  }

  // Resolve base URL
  let resolvedBaseUrl = DEFAULT_BASE_URL;
  if (config.baseUrl) {
    try {
      resolvedBaseUrl = interpolateEnvVars(config.baseUrl);
    } catch (error) {
      throw new Error(
        `Failed to resolve baseUrl in ${configPath}: ${(error as Error).message}`
      );
    }
  }

  // Detect git branch
  const gitBranch = getCurrentGitBranch();
  const tinybirdBranch = getTinybirdBranchName();

  // Resolve devMode (default to "branch")
  const devMode: DevMode = config.devMode ?? "branch";
  const branchDataOnCreate = resolveBranchDataOnCreate(config as unknown as Record<string, unknown>);
  if (branchDataOnCreate && devMode === "local") {
    console.warn(
      "branch_data_on_create is set in tinybird.config.json but dev_mode='local'. " +
      "Branch data settings only apply to cloud branches."
    );
  }

  return {
    include,
    token: resolvedToken,
    baseUrl: resolvedBaseUrl,
    configPath,
    cwd: configDir,
    gitBranch,
    tinybirdBranch,
    isMainBranch: isMainBranch(),
    devMode,
    branchDataOnCreate,
  };
}

/**
 * Load and resolve the Tinybird configuration
 *
 * Supports the following config file formats (in priority order):
 * - tinybird.config.mjs: ESM config with dynamic logic
 * - tinybird.config.cjs: CommonJS config with dynamic logic
 * - tinybird.config.json: Standard JSON config
 * - tinybird.json: Legacy JSON config (backward compatible)
 *
 * @param cwd - Working directory to start searching from (defaults to process.cwd())
 * @returns Resolved configuration
 *
 * @example
 * ```ts
 * const config = loadConfig();
 * console.log(config.include); // ['lib/tinybird.ts']
 * console.log(config.token);   // 'p.xxx' (resolved from ${TINYBIRD_TOKEN})
 * ```
 */
export function loadConfig(cwd: string = process.cwd()): ResolvedConfig {
  const configResult = findConfigFile(cwd);

  if (!configResult) {
    throw new Error(
      `Could not find config file. Run 'npx tinybird init' to create one.\n` +
      `Searched for: ${CONFIG_FILES.join(", ")}`
    );
  }

  const { path: configPath, type: configType } = configResult;

  // JSON files can be loaded synchronously
  if (configType === "tinybird.config.json" || configType === "tinybird.json") {
    let rawContent: string;
    try {
      rawContent = fs.readFileSync(configPath, "utf-8");
    } catch (error) {
      throw new Error(`Failed to read ${configPath}: ${(error as Error).message}`);
    }

    let config: TinybirdConfig;
    try {
      config = JSON.parse(rawContent) as TinybirdConfig;
    } catch (error) {
      throw new Error(`Failed to parse ${configPath}: ${(error as Error).message}`);
    }

    return resolveConfig(config, configPath);
  }

  // For JS files, we need to throw an error asking to use the async version
  throw new Error(
    `Config file ${configPath} is a JavaScript file. ` +
    `Use loadConfigAsync() instead of loadConfig() to load .mjs/.cjs config files.`
  );
}

/**
 * Load and resolve the Tinybird configuration (async version)
 *
 * This async version supports all config file formats including JS files
 * that may contain dynamic logic.
 *
 * @param cwd - Working directory to start searching from (defaults to process.cwd())
 * @returns Promise resolving to the configuration
 */
export async function loadConfigAsync(cwd: string = process.cwd()): Promise<ResolvedConfig> {
  const configResult = findConfigFile(cwd);

  if (!configResult) {
    throw new Error(
      `Could not find config file. Run 'npx tinybird init' to create one.\n` +
      `Searched for: ${CONFIG_FILES.join(", ")}`
    );
  }

  const { path: configPath } = configResult;

  // Use the universal config loader for all file types
  const { config } = await loadConfigFile<TinybirdConfig>(configPath);

  return resolveConfig(config, configPath);
}

/**
 * Check if a config file exists in the given directory or its parents
 */
export function configExists(cwd: string = process.cwd()): boolean {
  return findConfigFile(cwd) !== null;
}

/**
 * Get the path to an existing config file, or the default path for a new config
 * This is useful for the init command which needs to either update an existing config
 * or create a new one with the new default name
 */
export function getExistingOrNewConfigPath(cwd: string = process.cwd()): string {
  const existing = findExistingConfigPath(cwd);
  return existing ?? path.join(cwd, DEFAULT_CONFIG_FILE);
}

/**
 * Get the expected config file path for a directory
 * Returns the path for the default config file name (tinybird.config.json)
 */
export function getConfigPath(cwd: string = process.cwd()): string {
  return path.join(cwd, DEFAULT_CONFIG_FILE);
}

/**
 * Find an existing config file in a directory
 * Returns the path to the first matching config file, or null if none found
 */
export function findExistingConfigPath(cwd: string = process.cwd()): string | null {
  for (const configFile of CONFIG_FILES) {
    const configPath = path.join(cwd, configFile);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  return null;
}

/**
 * Update specific fields in a JSON config file
 *
 * Note: Only works with JSON config files (.json). For JS config files,
 * the user needs to update them manually.
 *
 * Throws an error if the config file doesn't exist to prevent creating
 * partial config files that would break loadConfig.
 *
 * @param configPath - Path to the config file
 * @param updates - Fields to update
 * @throws Error if config file doesn't exist or is not a JSON file
 */
export function updateConfig(
  configPath: string,
  updates: Partial<TinybirdConfig>
): void {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found at ${configPath}`);
  }

  if (!configPath.endsWith(".json")) {
    throw new Error(
      `Cannot update ${configPath}. Only JSON config files can be updated programmatically.`
    );
  }

  const content = fs.readFileSync(configPath, "utf-8");
  const config = JSON.parse(content) as TinybirdConfig;

  // Merge updates
  const updated = { ...config, ...updates };

  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2) + "\n");
}

/**
 * Check if a valid token is configured (either in file or via env var)
 *
 * Note: For JS config files, this only works if the token is a static value
 * or environment variable reference in the file.
 *
 * @param cwd - Working directory to search from
 * @returns true if a valid token exists
 */
export function hasValidToken(cwd: string = process.cwd()): boolean {
  try {
    const configResult = findConfigFile(cwd);
    if (!configResult) {
      return false;
    }

    // For JS files, we can't easily check without loading them
    // Return true and let loadConfig handle validation
    if (!configResult.path.endsWith(".json")) {
      return true;
    }

    const content = fs.readFileSync(configResult.path, "utf-8");
    const config = JSON.parse(content) as TinybirdConfig;

    if (!config.token) {
      return false;
    }

    // Check if token is a placeholder or env var reference
    if (config.token.includes("${")) {
      // Try to resolve the env var
      try {
        const resolved = interpolateEnvVars(config.token);
        return Boolean(resolved);
      } catch {
        return false;
      }
    }

    // Token is a literal value
    return Boolean(config.token);
  } catch {
    return false;
  }
}
