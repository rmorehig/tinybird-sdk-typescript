/**
 * Preview command - creates ephemeral preview branch and deploys resources
 */

import { loadConfigAsync, LOCAL_BASE_URL, type ResolvedConfig, type DevMode } from "../config.js";
import { BranchDataOnCreate } from "../config-types.js";
import { buildFromInclude, type BuildFromIncludeResult } from "../../generator/index.js";
import { createBranch, deleteBranch, getBranch, type TinybirdBranch } from "../../api/branches.js";
import { deployToMain } from "../../api/deploy.js";
import { buildToTinybird } from "../../api/build.js";
import {
  getLocalTokens,
  getOrCreateLocalWorkspace,
  LocalNotRunningError,
} from "../../api/local.js";
import { sanitizeBranchName, getCurrentGitBranch } from "../git.js";
import type { BuildApiResult } from "../../api/build.js";

/**
 * Preview command options
 */
export interface PreviewCommandOptions {
  /** Working directory (defaults to cwd) */
  cwd?: string;
  /** Skip pushing to API (just generate) */
  dryRun?: boolean;
  /** Validate deploy with Tinybird API without applying */
  check?: boolean;
  /** Override preview branch name */
  name?: string;
  /** Override the devMode from config */
  devModeOverride?: DevMode;
}

/**
 * Preview command result
 */
export interface PreviewCommandResult {
  /** Whether the preview was successful */
  success: boolean;
  /** Branch information */
  branch?: {
    name: string;
    id: string;
    token: string;
    url: string;
    created_at: string;
  };
  /** Build statistics */
  build?: {
    datasourceCount: number;
    pipeCount: number;
  };
  /** Deploy result */
  deploy?: {
    result: string;
  };
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Generate preview branch name with format: tmp_ci_${branch}
 *
 * Uses a deterministic name based on the git branch so that Vercel preview
 * deployments can find the branch by name.
 *
 * @param gitBranch - Current git branch name (or null)
 * @returns Preview branch name
 */
export function generatePreviewBranchName(gitBranch: string | null): string {
  const branchPart = gitBranch ? sanitizeBranchName(gitBranch) : "unknown";
  return `tmp_ci_${branchPart}`;
}

/**
 * Run the preview command
 *
 * Creates an ephemeral preview branch and deploys resources to it.
 * Preview branches are not cached and are meant for CI/testing.
 *
 * @param options - Preview options
 * @returns Preview command result
 */
export async function runPreview(options: PreviewCommandOptions = {}): Promise<PreviewCommandResult> {
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

  // Get current git branch and generate preview branch name
  const gitBranch = getCurrentGitBranch();
  const previewBranchName = options.name ?? generatePreviewBranchName(gitBranch);

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

  const buildStats = {
    datasourceCount: buildResult.stats.datasourceCount,
    pipeCount: buildResult.stats.pipeCount,
  };

  // If dry run, return without creating branch or deploying
  if (options.dryRun) {
    return {
      success: true,
      branch: {
        name: previewBranchName,
        id: "(dry-run)",
        token: "(dry-run)",
        url: config.baseUrl,
        created_at: new Date().toISOString(),
      },
      build: buildStats,
      durationMs: Date.now() - startTime,
    };
  }

  const debug = !!process.env.TINYBIRD_DEBUG;
  const devMode = options.devModeOverride ?? config.devMode;

  if (debug) {
    console.log(`[debug] devMode: ${devMode}`);
    console.log(`[debug] previewBranchName: ${previewBranchName}`);
  }

  // Handle local mode
  if (devMode === "local") {
    try {
      if (debug) {
        console.log(`[debug] Getting local tokens from ${LOCAL_BASE_URL}/tokens`);
      }

      const localTokens = await getLocalTokens();

      // Create workspace with preview branch name
      if (debug) {
        console.log(`[debug] Creating local workspace: ${previewBranchName}`);
      }

      const { workspace, wasCreated } = await getOrCreateLocalWorkspace(localTokens, previewBranchName);
      if (debug) {
        console.log(`[debug] Workspace ${wasCreated ? "created" : "found"}: ${workspace.name}`);
      }

      // Use /v1/build for local (no deploy endpoint in local)
      const deployResult = await buildToTinybird(
        {
          baseUrl: LOCAL_BASE_URL,
          token: workspace.token,
        },
        buildResult.resources
      );

      if (!deployResult.success) {
        return {
          success: false,
          branch: {
            name: previewBranchName,
            id: workspace.id,
            token: workspace.token,
            url: LOCAL_BASE_URL,
            created_at: new Date().toISOString(),
          },
          build: buildStats,
          error: deployResult.error,
          durationMs: Date.now() - startTime,
        };
      }

      return {
        success: true,
        branch: {
          name: previewBranchName,
          id: workspace.id,
          token: workspace.token,
          url: LOCAL_BASE_URL,
          created_at: new Date().toISOString(),
        },
        build: buildStats,
        deploy: {
          result: deployResult.result,
        },
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      if (error instanceof LocalNotRunningError) {
        return {
          success: false,
          error: error.message,
          durationMs: Date.now() - startTime,
        };
      }
      return {
        success: false,
        error: `Local preview failed: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // Cloud mode - delete existing branch if it exists, then create fresh and deploy
  let branch: TinybirdBranch;
  try {
    const apiConfig = { baseUrl: config.baseUrl, token: config.token };
    const lastPartitionFromConfig =
      config.branchDataOnCreate === BranchDataOnCreate.LAST_PARTITION;

    // Check if branch already exists and delete it for a fresh start
    try {
      const existingBranch = await getBranch(apiConfig, previewBranchName);
      if (existingBranch) {
        if (debug) {
          console.log(`[debug] Deleting existing preview branch: ${previewBranchName}`);
        }
        await deleteBranch(apiConfig, previewBranchName);
        if (debug) {
          console.log(`[debug] Existing branch deleted`);
        }
      }
    } catch {
      // Branch doesn't exist, that's fine
      if (debug) {
        console.log(`[debug] No existing branch to delete`);
      }
    }

    if (debug) {
      console.log(`[debug] Creating preview branch: ${previewBranchName}`);
    }

    branch = await createBranch(apiConfig, previewBranchName, {
      lastPartition: lastPartitionFromConfig,
    });

    if (debug) {
      console.log(`[debug] Branch created: ${branch.name} (${branch.id})`);
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to create preview branch: ${(error as Error).message}`,
      durationMs: Date.now() - startTime,
    };
  }

  if (!branch.token) {
    return {
      success: false,
      error: `Preview branch created but no token returned`,
      durationMs: Date.now() - startTime,
    };
  }

  // Deploy to branch using /v1/deploy (production-like experience)
  let deployResult: BuildApiResult;
  try {
    if (debug) {
      console.log(`[debug] Deploying to preview branch using branch token`);
    }

    deployResult = await deployToMain(
      { baseUrl: config.baseUrl, token: branch.token },
      buildResult.resources,
      { check: options.check, allowDestructiveOperations: true }
    );
  } catch (error) {
    return {
      success: false,
      branch: {
        name: branch.name,
        id: branch.id,
        token: branch.token,
        url: config.baseUrl,
        created_at: branch.created_at,
      },
      build: buildStats,
      error: `Deploy failed: ${(error as Error).message}`,
      durationMs: Date.now() - startTime,
    };
  }

  if (!deployResult.success) {
    return {
      success: false,
      branch: {
        name: branch.name,
        id: branch.id,
        token: branch.token,
        url: config.baseUrl,
        created_at: branch.created_at,
      },
      build: buildStats,
      error: deployResult.error,
      durationMs: Date.now() - startTime,
    };
  }

  return {
    success: true,
    branch: {
      name: branch.name,
      id: branch.id,
      token: branch.token,
      url: config.baseUrl,
      created_at: branch.created_at,
    },
    build: buildStats,
    deploy: {
      result: deployResult.result,
    },
    durationMs: Date.now() - startTime,
  };
}
