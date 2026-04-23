/**
 * Build command - generates and pushes resources to Tinybird branches
 */

import { loadConfigAsync, LOCAL_BASE_URL, type ResolvedConfig, type DevMode } from "../config.js";
import { BranchDataOnCreate } from "../config-types.js";
import { buildFromInclude, type BuildFromIncludeResult } from "../../generator/index.js";
import { buildToTinybird, type BuildApiResult } from "../../api/build.js";
import { getOrCreateBranch } from "../../api/branches.js";
import {
  getLocalTokens,
  getOrCreateLocalWorkspace,
  getLocalWorkspaceName,
  LocalNotRunningError,
} from "../../api/local.js";
import { getWorkspace } from "../../api/workspaces.js";
import { getBranchDashboardUrl, getLocalDashboardUrl } from "../../api/dashboard.js";

/**
 * Build command options
 */
export interface BuildCommandOptions {
  /** Working directory (defaults to cwd) */
  cwd?: string;
  /** Skip pushing to API (just generate) */
  dryRun?: boolean;
  /** Override the token from config (used for branch tokens) */
  tokenOverride?: string;
  /** Override the devMode from config */
  devModeOverride?: DevMode;
  /** Copy the last partition of production data when creating a branch */
  lastPartition?: boolean;
}

/**
 * Branch info included in build result
 */
export interface BuildBranchInfo {
  /** Git branch name */
  gitBranch: string | null;
  /** Tinybird branch name */
  tinybirdBranch: string | null;
  /** Whether the branch was newly created */
  wasCreated: boolean;
  /** Dashboard URL for the branch */
  dashboardUrl?: string;
  /** Whether using local mode */
  isLocal: boolean;
}

/**
 * Build command result
 */
export interface BuildCommandResult {
  /** Whether the build was successful */
  success: boolean;
  /** Build result with generated resources */
  build?: BuildFromIncludeResult;
  /** Build API result (if not dry run) */
  deploy?: BuildApiResult;
  /** Branch info (when building to a branch) */
  branchInfo?: BuildBranchInfo;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Run the build command
 *
 * Builds resources and pushes to Tinybird branches (not main).
 * Use runDeploy for deploying to production.
 *
 * @param options - Build options
 * @returns Build command result
 */
export async function runBuild(options: BuildCommandOptions = {}): Promise<BuildCommandResult> {
  const startTime = Date.now();
  const cwd = options.cwd ?? process.cwd();

  // Load config
  let config: ResolvedConfig;
  try {
    config = await loadConfigAsync(cwd);
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      durationMs: Date.now() - startTime,
    };
  }

  // Build resources from include paths
  let buildResult: BuildFromIncludeResult;
  try {
    buildResult = await buildFromInclude({
      includePaths: config.include,
      cwd: config.cwd,
    });
  } catch (error) {
    return {
      success: false,
      error: `Build failed: ${(error as Error).message}`,
      durationMs: Date.now() - startTime,
    };
  }

  // If dry run, return without pushing
  if (options.dryRun) {
    return {
      success: true,
      build: buildResult,
      durationMs: Date.now() - startTime,
    };
  }

  // Determine devMode
  const devMode = options.devModeOverride ?? config.devMode;
  const debug = !!process.env.TINYBIRD_DEBUG;

  if (debug) {
    console.log(`[debug] devMode: ${devMode}`);
  }

  let deployResult: BuildApiResult;
  let branchInfo: BuildBranchInfo | undefined;

  // Handle local mode
  if (devMode === "local") {
    try {
      // Get tokens from local container
      if (debug) {
        console.log(`[debug] Getting local tokens from ${LOCAL_BASE_URL}/tokens`);
      }

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
        if (debug) {
          console.log(`[debug] Using authenticated workspace name: ${workspaceName}`);
        }
      } else {
        // On feature branch: use branch name as before
        workspaceName = getLocalWorkspaceName(config.tinybirdBranch, config.cwd);
        if (debug) {
          console.log(`[debug] Using branch workspace: ${workspaceName}`);
        }
      }

      const { workspace, wasCreated } = await getOrCreateLocalWorkspace(localTokens, workspaceName);
      if (debug) {
        console.log(`[debug] Workspace ${wasCreated ? "created" : "found"}: ${workspace.name}`);
      }

      branchInfo = {
        gitBranch: config.gitBranch,
        tinybirdBranch: workspaceName,
        wasCreated,
        dashboardUrl: getLocalDashboardUrl(config.baseUrl, cloudWorkspaceName, workspaceName) ?? undefined,
        isLocal: true,
      };

      // Always use /v1/build for local (no deploy endpoint)
      deployResult = await buildToTinybird(
        {
          baseUrl: LOCAL_BASE_URL,
          token: workspace.token,
        },
        buildResult.resources
      );
    } catch (error) {
      if (error instanceof LocalNotRunningError) {
        return {
          success: false,
          build: buildResult,
          error: error.message,
          durationMs: Date.now() - startTime,
        };
      }
      return {
        success: false,
        build: buildResult,
        error: `Local build failed: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  } else {
    // Branch mode (default)
    // Prevent building to main - must use deploy command
    // Skip this check if tokenOverride is provided (dev command passes branch token)
    const isMainBranch = config.isMainBranch || !config.tinybirdBranch;

    if (isMainBranch && !options.tokenOverride) {
      return {
        success: false,
        build: buildResult,
        error: `Cannot deploy to main workspace with 'build' command. Use 'tinybird deploy' to deploy to production, or switch to a feature branch.`,
        durationMs: Date.now() - startTime,
      };
    }

    if (debug) {
      console.log(`[debug] isMainBranch: ${config.isMainBranch}`);
      console.log(`[debug] tinybirdBranch: ${config.tinybirdBranch}`);
      console.log(`[debug] tokenOverride: ${!!options.tokenOverride}`);
    }

    let effectiveToken = options.tokenOverride ?? config.token;

    // Get or create the Tinybird branch and use its token
    if (!options.tokenOverride) {
      if (debug) {
        console.log(`[debug] Getting/creating Tinybird branch: ${config.tinybirdBranch}`);
      }
      try {
        const lastPartitionFromConfig =
          config.branchDataOnCreate === BranchDataOnCreate.LAST_PARTITION;
        const lastPartitionFromFlag = Boolean(options.lastPartition);
        const tinybirdBranch = await getOrCreateBranch(
          {
            baseUrl: config.baseUrl,
            token: config.token,
          },
          config.tinybirdBranch!,
          { lastPartition: lastPartitionFromFlag || lastPartitionFromConfig }
        );

        if (!tinybirdBranch.token) {
          return {
            success: false,
            build: buildResult,
            error: `Branch '${config.tinybirdBranch}' was created but no token was returned.`,
            durationMs: Date.now() - startTime,
          };
        }

        effectiveToken = tinybirdBranch.token;
        if (debug) {
          console.log(`[debug] Using branch token for branch: ${config.tinybirdBranch}`);
        }

        // Get workspace name for dashboard URL
        const workspace = await getWorkspace({
          baseUrl: config.baseUrl,
          token: config.token,
        });
        const dashboardUrl = getBranchDashboardUrl(config.baseUrl, workspace.name, config.tinybirdBranch!) ?? undefined;

        branchInfo = {
          gitBranch: config.gitBranch,
          tinybirdBranch: config.tinybirdBranch,
          wasCreated: tinybirdBranch.wasCreated ?? false,
          dashboardUrl,
          isLocal: false,
        };
      } catch (error) {
        return {
          success: false,
          build: buildResult,
          error: `Failed to get/create branch: ${(error as Error).message}`,
          durationMs: Date.now() - startTime,
        };
      }
    }

    try {
      // Always use /v1/build for branches
      deployResult = await buildToTinybird(
        {
          baseUrl: config.baseUrl,
          token: effectiveToken,
        },
        buildResult.resources
      );
    } catch (error) {
      return {
        success: false,
        build: buildResult,
        error: `Deploy failed: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  if (!deployResult.success) {
    return {
      success: false,
      build: buildResult,
      deploy: deployResult,
      branchInfo,
      error: deployResult.error,
      durationMs: Date.now() - startTime,
    };
  }

  return {
    success: true,
    build: buildResult,
    deploy: deployResult,
    branchInfo,
    durationMs: Date.now() - startTime,
  };
}
