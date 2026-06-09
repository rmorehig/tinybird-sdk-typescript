/**
 * Clear command - clears a local workspace or branch by deleting and recreating it
 */

import { loadConfigAsync, type ResolvedConfig, type DevMode } from "../config.js";
import {
  getLocalTokens,
  clearLocalWorkspace,
  getLocalWorkspaceName,
  LocalNotRunningError,
  LocalApiError,
} from "../../api/local.js";
import {
  clearBranch,
  BranchApiError,
  type CreateBranchOptions,
} from "../../api/branches.js";
import { BranchDataMode } from "../config-types.js";
import {
  setBranchToken,
  removeBranch as removeCachedBranch,
} from "../branch-store.js";
import { getWorkspace } from "../../api/workspaces.js";

/**
 * Clear command options
 */
export interface ClearCommandOptions {
  /** Working directory (defaults to cwd) */
  cwd?: string;
  /** Override the dev mode from config */
  devModeOverride?: DevMode;
}

/**
 * Result of clearing a workspace or branch
 */
export interface ClearResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Name of the cleared workspace or branch */
  name?: string;
  /** Whether local mode was used */
  isLocal?: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Clear a local workspace or branch by deleting and recreating it
 *
 * In local mode: deletes and recreates the local workspace
 * In branch mode: deletes and recreates the Tinybird branch
 *
 * @param options - Command options
 * @returns Clear result
 */
export async function runClear(
  options: ClearCommandOptions = {}
): Promise<ClearResult> {
  const cwd = options.cwd ?? process.cwd();

  let config: ResolvedConfig;
  try {
    config = await loadConfigAsync(cwd);
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }

  // Determine dev mode
  const devMode = options.devModeOverride ?? config.devMode;

  if (devMode === "local") {
    return clearLocal(config);
  } else {
    return clearCloudBranch(config);
  }
}

/**
 * Clear a local workspace
 */
async function clearLocal(config: ResolvedConfig): Promise<ClearResult> {
  // Get workspace name from git branch or path hash
  const workspaceName = getLocalWorkspaceName(config.tinybirdBranch, config.cwd);

  try {
    // Get local tokens
    const tokens = await getLocalTokens();

    // Clear the workspace
    await clearLocalWorkspace(tokens, workspaceName);

    return {
      success: true,
      name: workspaceName,
      isLocal: true,
    };
  } catch (error) {
    if (error instanceof LocalNotRunningError) {
      return {
        success: false,
        error: error.message,
      };
    }

    if (error instanceof LocalApiError) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Clear a cloud branch
 */
async function clearCloudBranch(config: ResolvedConfig): Promise<ClearResult> {
  // Must be on a non-main branch to clear
  if (config.isMainBranch) {
    return {
      success: false,
      error: "Cannot clear the main branch. Use 'tinybird deploy' to manage the main workspace.",
    };
  }

  const branchName = config.tinybirdBranch;
  if (!branchName) {
    return {
      success: false,
      error: "Could not detect git branch. Make sure you are in a git repository.",
    };
  }

  try {
    // Get workspace ID for cache management
    const workspace = await getWorkspace({
      baseUrl: config.baseUrl,
      token: config.token,
    });

    // Clear the branch (delete and recreate)
    const branchOptions: CreateBranchOptions | undefined =
      config.devMode !== "local" && config.branchDataMode === BranchDataMode.LAST_PARTITION
        ? { lastPartition: true }
        : undefined;

    const newBranch = await clearBranch(
      {
        baseUrl: config.baseUrl,
        token: config.token,
      },
      branchName,
      branchOptions
    );

    // Update the cached token with the new branch token
    if (newBranch.token) {
      setBranchToken(workspace.id, branchName, {
        token: newBranch.token,
        id: newBranch.id,
        createdAt: newBranch.created_at,
      });
    } else {
      // If no token in response, remove cached token
      removeCachedBranch(workspace.id, branchName);
    }

    return {
      success: true,
      name: branchName,
      isLocal: false,
    };
  } catch (error) {
    if (error instanceof BranchApiError) {
      if (error.status === 404) {
        return {
          success: false,
          error: `Branch '${branchName}' does not exist. Run 'npx tinybird dev' to create it first.`,
        };
      }
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: false,
      error: (error as Error).message,
    };
  }
}
