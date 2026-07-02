/**
 * Deploy command - deploys resources to main Tinybird workspace
 */

import { loadConfigAsync, type ResolvedConfig } from "../config.js";
import { buildFromInclude, type BuildFromIncludeResult } from "../../generator/index.js";
import { deployToMain, type DeployCallbacks } from "../../api/deploy.js";
import type { BuildApiResult } from "../../api/build.js";

/**
 * Deploy command options
 */
export interface DeployCommandOptions {
  /** Working directory (defaults to cwd) */
  cwd?: string;
  /** Skip pushing to API (just generate) */
  dryRun?: boolean;
  /** Validate deploy with Tinybird API without applying */
  check?: boolean;
  /** Allow deleting existing resources in main workspace deploys */
  allowDestructiveOperations?: boolean;
  /**
   * Wait for the deployment to finish. Defaults to true.
   */
  wait?: boolean;
  /**
   * Auto-promote the deployment when it's ready. Defaults to true.
   */
  auto?: boolean;
  /** Callbacks for deploy progress */
  callbacks?: DeployCallbacks;
}

/**
 * Deploy command result
 */
export interface DeployCommandResult {
  /** Whether the deploy was successful */
  success: boolean;
  /** Build result with generated resources */
  build?: BuildFromIncludeResult;
  /** Deploy API result (if not dry run) */
  deploy?: BuildApiResult;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Run the deploy command
 *
 * Builds resources and deploys to main Tinybird workspace (production).
 *
 * @param options - Deploy options
 * @returns Deploy command result
 */
export async function runDeploy(options: DeployCommandOptions = {}): Promise<DeployCommandResult> {
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

  const debug = !!process.env.TINYBIRD_DEBUG;

  if (debug) {
    console.log(`[debug] Deploying to main workspace`);
    console.log(`[debug] baseUrl: ${config.baseUrl}`);
  }

  // Deploy to main workspace using /v1/deploy endpoint
  let deployResult: BuildApiResult;
  try {
    deployResult = await deployToMain(
      {
        baseUrl: config.baseUrl,
        token: config.token,
      },
      buildResult.resources,
      {
        check: options.check,
        allowDestructiveOperations: options.allowDestructiveOperations,
        wait: options.wait,
        auto: options.auto,
        callbacks: options.callbacks,
      }
    );
  } catch (error) {
    return {
      success: false,
      build: buildResult,
      error: `Deploy failed: ${(error as Error).message}`,
      durationMs: Date.now() - startTime,
    };
  }

  if (!deployResult.success) {
    return {
      success: false,
      build: buildResult,
      deploy: deployResult,
      error: deployResult.error,
      durationMs: Date.now() - startTime,
    };
  }

  return {
    success: true,
    build: buildResult,
    deploy: deployResult,
    durationMs: Date.now() - startTime,
  };
}
