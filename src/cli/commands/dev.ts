/**
 * Dev command - watch mode with automatic sync
 */

import * as path from "path";
import { watch } from "chokidar";
import {
  loadConfigAsync,
  configExists,
  findConfigFile,
  hasValidToken,
  updateConfig,
  LOCAL_BASE_URL,
  type ResolvedConfig,
  type DevMode,
} from "../config.js";
import { BranchDataOnCreate } from "../config-types.js";
import { runBuild, type BuildCommandResult } from "./build.js";
import { getOrCreateBranch, type TinybirdBranch } from "../../api/branches.js";
import { browserLogin } from "../auth.js";
import { saveTinybirdToken } from "../env.js";
import {
  validatePipeSchemas,
  type SchemaValidationResult,
} from "../utils/schema-validation.js";
import {
  getLocalTokens,
  getOrCreateLocalWorkspace,
  getLocalWorkspaceName,
  type LocalWorkspace,
} from "../../api/local.js";
import { getWorkspace } from "../../api/workspaces.js";
import { getBranchDashboardUrl, getLocalDashboardUrl } from "../../api/dashboard.js";
import { getIncludeWatchDirectories } from "../../generator/include-paths.js";

/**
 * Login result info
 */
export interface LoginInfo {
  /** Workspace name */
  workspaceName?: string;
  /** User email */
  userEmail?: string;
}

/**
 * Dev command options
 */
export interface DevCommandOptions {
  /** Working directory (defaults to cwd) */
  cwd?: string;
  /** Debounce delay in milliseconds (default: 100) */
  debounce?: number;
  /** Callback when build starts */
  onBuildStart?: () => void;
  /** Callback when build completes */
  onBuildComplete?: (result: BuildCommandResult) => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
  /** Callback when branch is created/detected */
  onBranchReady?: (info: BranchReadyInfo) => void;
  /** Callback when login is needed and completed */
  onLoginComplete?: (info: LoginInfo) => void;
  /** Callback when schema validation completes */
  onSchemaValidation?: (result: SchemaValidationResult) => void;
  /** Override the devMode from config */
  devModeOverride?: DevMode;
  /** Copy the last partition of production data when creating a branch */
  lastPartition?: boolean;
}

/**
 * Information about the branch being used
 */
export interface BranchReadyInfo {
  /** Git branch name */
  gitBranch: string | null;
  /** Whether we're on the main branch */
  isMainBranch: boolean;
  /** Tinybird branch info (null if on main or local mode) */
  tinybirdBranch?: TinybirdBranch;
  /** Whether the branch was newly created */
  wasCreated?: boolean;
  /** Whether using local mode */
  isLocal?: boolean;
  /** Local workspace info (only in local mode) */
  localWorkspace?: LocalWorkspace;
  /** Dashboard URL for the branch (only in branch mode) */
  dashboardUrl?: string;
}

/**
 * Dev command controller
 */
export interface DevController {
  /** Stop watching and clean up */
  stop: () => Promise<void>;
  /** Trigger a manual rebuild */
  rebuild: () => Promise<BuildCommandResult>;
  /** The configuration being used */
  config: ResolvedConfig;
  /** The effective token (branch token or main token) */
  effectiveToken: string;
  /** Branch info */
  branchInfo: BranchReadyInfo;
}

/**
 * Run the dev command
 *
 * Watches for file changes and automatically rebuilds and pushes to Tinybird.
 * Automatically manages Tinybird branches based on git branch:
 * - Main branch: uses workspace token and /v1/deploy
 * - Feature branches: creates/reuses Tinybird branch and uses /v1/build
 *
 * @param options - Dev options
 * @returns Dev controller
 */
export async function runDev(
  options: DevCommandOptions = {}
): Promise<DevController> {
  const cwd = options.cwd ?? process.cwd();
  const debounceMs = options.debounce ?? 100;

  // Check if project is initialized
  if (!configExists(cwd)) {
    throw new Error(
      "No tinybird config found. Run 'npx tinybird init' to initialize a project."
    );
  }

  // Load config first to determine devMode
  let config: ResolvedConfig;
  try {
    config = await loadConfigAsync(cwd);
  } catch (error) {
    throw error;
  }

  // Determine devMode
  const devMode = options.devModeOverride ?? config.devMode;

  // Check if authentication is set up, if not trigger login (skip for local mode)
  if (devMode !== "local" && !hasValidToken(cwd)) {
    console.log("No authentication found. Starting login flow...\n");

    const authResult = await browserLogin();

    if (!authResult.success || !authResult.token) {
      throw new Error(
        authResult.error ??
          "Login failed. Run 'npx tinybird login' to authenticate."
      );
    }

    // Find the config file (may be in parent directory)
    const configResult = findConfigFile(cwd);
    if (!configResult) {
      throw new Error("No tinybird config found. Run 'npx tinybird init' first.");
    }

    // Save token to .env.local (in same directory as config file)
    const configDir = path.dirname(configResult.path);
    saveTinybirdToken(configDir, authResult.token);

    // Update baseUrl in config file if it changed (only for JSON configs)
    if (authResult.baseUrl && configResult.path.endsWith(".json")) {
      updateConfig(configResult.path, {
        baseUrl: authResult.baseUrl,
      });
    }

    // Set the token in the environment for this session
    process.env.TINYBIRD_TOKEN = authResult.token;

    options.onLoginComplete?.({
      workspaceName: authResult.workspaceName,
      userEmail: authResult.userEmail,
    });

    // Reload config after login
    config = await loadConfigAsync(cwd);
  }

  // Determine effective token and branch info based on devMode
  let effectiveToken = config.token;
  let effectiveBaseUrl = config.baseUrl;
  let branchInfo: BranchReadyInfo = {
    gitBranch: config.gitBranch,
    isMainBranch: config.isMainBranch,
  };

  if (devMode === "local") {
    // Local mode: get tokens from local container and set up workspace
    const localTokens = await getLocalTokens();

    // Always fetch the cloud workspace name for dashboard URL
    const authenticatedWorkspace = await getWorkspace({
      baseUrl: config.baseUrl,
      token: config.token,
    });
    const cloudWorkspaceName = authenticatedWorkspace.name;

    // Determine workspace name: use authenticated workspace name on main branch,
    // otherwise use branch name (for trunk-based development support)
    let workspaceName: string;
    if (config.isMainBranch || !config.tinybirdBranch) {
      // On main branch: use the authenticated workspace name
      workspaceName = cloudWorkspaceName;
    } else {
      // On feature branch: use branch name
      workspaceName = getLocalWorkspaceName(config.tinybirdBranch, config.cwd);
    }

    const { workspace, wasCreated } = await getOrCreateLocalWorkspace(
      localTokens,
      workspaceName
    );

    effectiveToken = workspace.token;
    effectiveBaseUrl = LOCAL_BASE_URL;
    branchInfo = {
      gitBranch: config.gitBranch,
      isMainBranch: false, // Local mode always uses build, not deploy
      isLocal: true,
      localWorkspace: workspace,
      wasCreated,
      dashboardUrl: getLocalDashboardUrl(config.baseUrl, cloudWorkspaceName, workspace.name) ?? undefined,
    };
  } else {
    // Branch mode: use Tinybird cloud with branches
    // Prevent dev mode on main branch - must use deploy command
    if (config.isMainBranch || !config.tinybirdBranch) {
      throw new Error(
        `Cannot use 'dev' command on main branch. Use 'tinybird deploy' to deploy to production, or switch to a feature branch.`
      );
    }

    // Get or create the Tinybird branch
    // Use tinybirdBranch (sanitized name) for Tinybird API, gitBranch for display
    if (config.tinybirdBranch) {
      const branchName = config.tinybirdBranch; // Sanitized name for Tinybird
      const lastPartitionFromConfig =
        config.branchDataOnCreate === BranchDataOnCreate.LAST_PARTITION;
      const lastPartitionFromFlag = Boolean(options.lastPartition);

      // Always fetch fresh from API to avoid stale cache issues
      const tinybirdBranch = await getOrCreateBranch(
        {
          baseUrl: config.baseUrl,
          token: config.token,
        },
        branchName,
        { lastPartition: lastPartitionFromFlag || lastPartitionFromConfig }
      );

      if (!tinybirdBranch.token) {
        throw new Error(
          `Branch '${branchName}' was created but no token was returned. ` +
            `This may be an API issue.`
        );
      }

      effectiveToken = tinybirdBranch.token;

      // Get workspace name for dashboard URL
      const workspace = await getWorkspace({
        baseUrl: config.baseUrl,
        token: config.token,
      });
      const dashboardUrl =
        getBranchDashboardUrl(config.baseUrl, workspace.name, branchName) ??
        undefined;

      branchInfo = {
        gitBranch: config.gitBranch, // Original git branch name for display
        isMainBranch: false,
        tinybirdBranch,
        wasCreated: tinybirdBranch.wasCreated ?? false,
        dashboardUrl,
      };
    }
  }

  // Notify about branch readiness
  options.onBranchReady?.(branchInfo);

  // Get directories to watch from include paths (supports glob include patterns)
  const watchDirs = getIncludeWatchDirectories(config.include, config.cwd);

  // Debounce state
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isBuilding = false;
  let pendingBuild = false;

  // Build function
  async function doBuild(): Promise<BuildCommandResult> {
    if (isBuilding) {
      pendingBuild = true;
      return {
        success: false,
        error: "Build already in progress",
        durationMs: 0,
      };
    }

    isBuilding = true;
    options.onBuildStart?.();

    try {
      // Always use runBuild - main branch is blocked at startup
      const result = await runBuild({
        cwd: config.cwd,
        tokenOverride: effectiveToken,
        devModeOverride: devMode,
      });
      options.onBuildComplete?.(result);

      // Validate pipe schemas after successful deploy
      if (
        result.success &&
        result.build?.entities &&
        result.deploy?.pipes &&
        options.onSchemaValidation
      ) {
        // Get changed pipes from deploy result
        const changedPipes = [
          ...result.deploy.pipes.created,
          ...result.deploy.pipes.changed,
        ];

        if (changedPipes.length > 0) {
          try {
            const validation = await validatePipeSchemas({
              entities: result.build.entities,
              pipeNames: changedPipes,
              baseUrl: effectiveBaseUrl,
              token: effectiveToken,
            });

            options.onSchemaValidation(validation);
          } catch (validationError) {
            // Don't fail the build due to validation errors
            options.onError?.(validationError as Error);
          }
        }
      }

      return result;
    } catch (error) {
      const result: BuildCommandResult = {
        success: false,
        error: (error as Error).message,
        durationMs: 0,
      };
      options.onBuildComplete?.(result);
      return result;
    } finally {
      isBuilding = false;

      // If there was a pending build, trigger it
      if (pendingBuild) {
        pendingBuild = false;
        scheduleBuild();
      }
    }
  }

  // Schedule a debounced build
  function scheduleBuild(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      doBuild().catch((error) => {
        options.onError?.(error as Error);
      });
    }, debounceMs);
  }

  // Set up file watcher for all include directories
  const watcher = watch(watchDirs, {
    ignored: [
      /(^|[\/\\])\../, // Ignore dotfiles
      /node_modules/,
      /\.tinybird-schema-.*\.mjs$/, // Ignore temporary bundle files
      /\.tinybird-entities-.*\.mjs$/, // Ignore temporary entity files
    ],
    persistent: true,
    ignoreInitial: true,
  });

  // Watch for changes
  watcher.on("change", (filePath) => {
    if (filePath.endsWith(".ts") || filePath.endsWith(".js")) {
      scheduleBuild();
    }
  });

  watcher.on("add", (filePath) => {
    if (filePath.endsWith(".ts") || filePath.endsWith(".js")) {
      scheduleBuild();
    }
  });

  watcher.on("unlink", (filePath) => {
    if (filePath.endsWith(".ts") || filePath.endsWith(".js")) {
      scheduleBuild();
    }
  });

  watcher.on("error", (error: unknown) => {
    options.onError?.(
      error instanceof Error ? error : new Error(String(error))
    );
  });

  // Do initial build
  await doBuild();

  // Return controller
  return {
    stop: async () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      await watcher.close();
    },
    rebuild: doBuild,
    config,
    effectiveToken,
    branchInfo,
  };
}
