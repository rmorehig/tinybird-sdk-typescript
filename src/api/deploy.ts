/**
 * Deploy resources to Tinybird main workspace
 * Uses the /v1/deploy endpoint to create a deployment, then sets it live
 */

import type { GeneratedResources } from "../generator/index.js";
import type { BuildConfig, BuildApiResult } from "./build.js";
import { tinybirdFetch } from "./fetcher.js";

const FORWARD_CLASSIC_GUIDANCE =
  "Use the Tinybird Classic CLI (`tb`) from a Tinybird Classic workspace for this operation.";

/**
 * Poll interval used while waiting for a deployment to reach `data_ready`
 * (and, when auto-promoting, `live`). Matches the Tinybird CLI (`tb deploy`).
 */
const POLL_INTERVAL_MS = 5_000;

/**
 * How many consecutive `failed` status polls to tolerate before giving up.
 * With a 5s poll interval this is ~5 minutes, matching the CLI safety valve
 * for deployments that fail but never auto-delete.
 */
export const MAX_CONSECUTIVE_FAILED_POLLS = 60;

/**
 * Feedback item from deployment response
 */
export interface DeploymentFeedback {
  resource: string | null;
  level: "ERROR" | "WARNING" | "INFO";
  message: string;
}

/**
 * Deployment object returned by the /v1/deploy endpoint
 */
export interface Deployment {
  id: string;
  status: string;
  live?: boolean;
  created_at?: string;
  updated_at?: string;
  feedback?: DeploymentFeedback[];
}

/**
 * Response from /v1/deployments list endpoint
 */
export interface DeploymentsListResponse {
  deployments: Deployment[];
}

/**
 * Response from /v1/deploy endpoint
 */
export interface DeployResponse {
  result: "success" | "failed" | "no_changes";
  deployment?: DeploymentDetails;
  error?: string;
  errors?: Array<{ filename?: string; error: string }>;
}

/**
 * Detailed deployment information with resource changes
 */
export interface DeploymentDetails extends Deployment {
  /** Names of newly created datasources */
  new_datasource_names?: string[];
  /** Names of changed datasources */
  changed_datasource_names?: string[];
  /** Names of deleted datasources */
  deleted_datasource_names?: string[];
  /** Names of newly created pipes */
  new_pipe_names?: string[];
  /** Names of changed pipes */
  changed_pipe_names?: string[];
  /** Names of deleted pipes */
  deleted_pipe_names?: string[];
  /** Names of newly created connections */
  new_data_connector_names?: string[];
  /** Names of changed connections */
  changed_data_connector_names?: string[];
  /** Names of deleted connections */
  deleted_data_connector_names?: string[];
  /** Deployment errors */
  errors?: Array<{ filename?: string; error: string }>;
}

/**
 * Response from /v1/deployments/{id} endpoint
 */
export interface DeploymentStatusResponse {
  result: string;
  deployment: Deployment;
}

/**
 * Deploy generated resources to Tinybird main workspace
 *
 * Uses the /v1/deploy endpoint which accepts all resources in a single
 * multipart form request. After creating the deployment, this function:
 * 1. When `auto` is true (default), sends `auto_promote=true` so the
 *    server promotes the deployment as soon as it's ready.
 * 2. When `wait` is true (default), polls until the deployment reaches
 *    `data_ready` (and, if `auto` is also true, until it becomes live).
 *
 * @param config - Build configuration with API URL and token
 * @param resources - Generated resources to deploy
 * @returns Build result
 *
 * @example
 * ```ts
 * const result = await deployToMain(
 *   {
 *     baseUrl: 'https://api.tinybird.co',
 *     token: 'p.xxx',
 *   },
 *   {
 *     datasources: [{ name: 'events', content: '...' }],
 *     pipes: [{ name: 'top_events', content: '...' }],
 *   }
 * );
 *
 * if (result.success) {
 *   console.log('Deployed to main workspace!');
 * }
 * ```
 */
/**
 * Callbacks for deploy progress updates
 */
/**
 * Resource changes from deployment
 */
export interface DeploymentChanges {
  datasources: {
    created: string[];
    changed: string[];
    deleted: string[];
  };
  pipes: {
    created: string[];
    changed: string[];
    deleted: string[];
  };
  connections: {
    created: string[];
    changed: string[];
    deleted: string[];
  };
}

export interface DeployCallbacks {
  /** Called when deployment is created and changes are available */
  onChanges?: (changes: DeploymentChanges) => void;
  /** Called when deployment was submitted but wait was disabled */
  onDeploymentSubmitted?: (deploymentId: string) => void;
  /** Called when waiting for deployment to be ready */
  onWaitingForReady?: () => void;
  /** Called when deployment is ready */
  onDeploymentReady?: () => void;
  /** Called when waiting for deployment to be promoted */
  onWaitingForPromote?: () => void;
  /** Called when deployment is promoted */
  onDeploymentPromoted?: () => void;
  /** Called when deployment is live */
  onDeploymentLive?: (deploymentId: string) => void;
  /** Called when validating deployment (check mode) */
  onValidating?: () => void;
}

export async function deployToMain(
  config: BuildConfig,
  resources: GeneratedResources,
  options?: {
    debug?: boolean;
    check?: boolean;
    allowDestructiveOperations?: boolean;
    wait?: boolean;
    auto?: boolean;
    callbacks?: DeployCallbacks;
  }
): Promise<BuildApiResult> {
  const debug = options?.debug ?? !!process.env.TINYBIRD_DEBUG;
  const wait = options?.wait ?? true;
  const auto = options?.auto ?? true;
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  const formData = new FormData();

  // Add datasources
  for (const ds of resources.datasources) {
    const fieldName = `data_project://`;
    const fileName = `${ds.name}.datasource`;
    if (debug) {
      console.log(`[debug] Adding datasource: ${fieldName} (filename: ${fileName})`);
      console.log(`[debug] Content:\n${ds.content}\n`);
    }
    formData.append(
      fieldName,
      new Blob([ds.content], { type: "text/plain" }),
      fileName
    );
  }

  // Add pipes
  for (const pipe of resources.pipes) {
    const fieldName = `data_project://`;
    const fileName = `${pipe.name}.pipe`;
    if (debug) {
      console.log(`[debug] Adding pipe: ${fieldName} (filename: ${fileName})`);
      console.log(`[debug] Content:\n${pipe.content}\n`);
    }
    formData.append(
      fieldName,
      new Blob([pipe.content], { type: "text/plain" }),
      fileName
    );
  }

  // Add connections
  for (const conn of resources.connections ?? []) {
    const fieldName = `data_project://`;
    const fileName = `${conn.name}.connection`;
    if (debug) {
      console.log(`[debug] Adding connection: ${fieldName} (filename: ${fileName})`);
      console.log(`[debug] Content:\n${conn.content}\n`);
    }
    formData.append(
      fieldName,
      new Blob([conn.content], { type: "text/plain" }),
      fileName
    );
  }

  // Step 0: Clean up any stale non-live deployments that might block the new deployment.
  // Skipped in check mode so validation runs don't tear down in-flight deployments.
  if (!options?.check) {
    try {
      const deploymentsUrl = `${baseUrl}/v1/deployments`;
      const deploymentsResponse = await tinybirdFetch(deploymentsUrl, {
        headers: {
          Authorization: `Bearer ${config.token}`,
        },
      });

      if (deploymentsResponse.ok) {
        const deploymentsBody = (await deploymentsResponse.json()) as DeploymentsListResponse;
        const staleDeployments = deploymentsBody.deployments.filter(
          (d) => !d.live && d.status !== "live"
        );

        for (const stale of staleDeployments) {
          if (debug) {
            console.log(`[debug] Cleaning up stale deployment: ${stale.id} (status: ${stale.status})`);
          }
          await tinybirdFetch(`${baseUrl}/v1/deployments/${stale.id}`, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${config.token}`,
            },
          });
        }
      }
    } catch (e) {
      // Ignore errors during cleanup - we'll try to deploy anyway
      if (debug) {
        console.log(`[debug] Failed to clean up stale deployments: ${e}`);
      }
    }
  }

  // Step 1: Create deployment via /v1/deploy
  const deployUrlBase = `${baseUrl}/v1/deploy`;
  const urlParams = new URLSearchParams();
  if (options?.check) {
    urlParams.set("check", "true");
  } else if (auto) {
    // Server will auto-promote the deployment when it's ready
    urlParams.set("auto_promote", "true");
  }
  if (options?.allowDestructiveOperations) {
    urlParams.set("allow_destructive_operations", "true");
  }
  const queryString = urlParams.toString();
  const deployUrl = queryString ? `${deployUrlBase}?${queryString}` : deployUrlBase;

  if (debug) {
    console.log(`[debug] POST ${deployUrl}`);
  }

  const response = await tinybirdFetch(deployUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
    body: formData,
  });

  // Parse response
  let body: DeployResponse;
  const rawBody = await response.text();

  if (debug) {
    console.log(`[debug] Response status: ${response.status}`);
    console.log(`[debug] Response body: ${rawBody}`);
  }

  try {
    body = JSON.parse(rawBody) as DeployResponse;
  } catch {
    throw new Error(
      `Failed to parse response from Tinybird API: ${response.status} ${response.statusText}\nBody: ${rawBody}`
    );
  }

  // Helper to format feedback from deployment
  const formatFeedback = (feedback: DeploymentFeedback[]): string => {
    return feedback
      .map((f) => {
        // Extract just the filename from "Datasource events.datasource" format
        const resourceName = f.resource?.split(" ").pop() ?? f.resource ?? "unknown";
        return `${resourceName}: ${normalizeDeployErrorMessage(f.message)}`;
      })
      .join("\n");
  };

  // Helper to format errors
  const formatErrors = (): string => {
    // Check for feedback in deployment (most detailed error info)
    if (body.deployment?.feedback && body.deployment.feedback.length > 0) {
      const errors = body.deployment.feedback.filter((f) => f.level === "ERROR");
      if (errors.length > 0) {
        return formatFeedback(errors);
      }
    }
    if (body.errors && body.errors.length > 0) {
      return body.errors
        .map((e) => {
          const prefix = e.filename ? `[${e.filename}] ` : "";
          return `${prefix}${normalizeDeployErrorMessage(e.error)}`;
        })
        .join("\n");
    }
    if (body.error) {
      return normalizeDeployErrorMessage(body.error);
    }
    // Include raw response body for debugging when no structured error is available
    return `HTTP ${response.status}: ${response.statusText}\nResponse: ${rawBody}`;
  };

  // Handle non-OK responses
  if (!response.ok) {
    return {
      success: false,
      result: "failed",
      error: formatErrors(),
      datasourceCount: resources.datasources.length,
      pipeCount: resources.pipes.length,
      connectionCount: resources.connections?.length ?? 0,
    };
  }

  if (options?.check) {
    options.callbacks?.onValidating?.();

    if (body.result === "failed") {
      return {
        success: false,
        result: "failed",
        error: formatErrors(),
        datasourceCount: resources.datasources.length,
        pipeCount: resources.pipes.length,
        connectionCount: resources.connections?.length ?? 0,
      };
    }

    return {
      success: true,
      result: body.result ?? "success",
      datasourceCount: resources.datasources.length,
      pipeCount: resources.pipes.length,
      connectionCount: resources.connections?.length ?? 0,
    };
  }

  // Handle no changes - no deployment was created, so we can return early
  if (body.result === "no_changes") {
    return {
      success: true,
      result: "no_changes",
      datasourceCount: resources.datasources.length,
      pipeCount: resources.pipes.length,
      connectionCount: resources.connections?.length ?? 0,
      pipes: {
        changed: [],
        created: [],
        deleted: [],
      },
      datasources: {
        changed: [],
        created: [],
        deleted: [],
      },
    };
  }

  // Handle API result
  if (body.result === "failed" || !body.deployment) {
    return {
      success: false,
      result: "failed",
      error: formatErrors(),
      datasourceCount: resources.datasources.length,
      pipeCount: resources.pipes.length,
      connectionCount: resources.connections?.length ?? 0,
    };
  }

  const deploymentId = body.deployment.id;
  const deploymentDetails = body.deployment;

  if (debug) {
    console.log(`[debug] Deployment created with ID: ${deploymentId}`);
  }

  // Notify about changes immediately after deployment is created
  if (options?.callbacks?.onChanges) {
    options.callbacks.onChanges({
      datasources: {
        created: deploymentDetails.new_datasource_names ?? [],
        changed: deploymentDetails.changed_datasource_names ?? [],
        deleted: deploymentDetails.deleted_datasource_names ?? [],
      },
      pipes: {
        created: deploymentDetails.new_pipe_names ?? [],
        changed: deploymentDetails.changed_pipe_names ?? [],
        deleted: deploymentDetails.deleted_pipe_names ?? [],
      },
      connections: {
        created: deploymentDetails.new_data_connector_names ?? [],
        changed: deploymentDetails.changed_data_connector_names ?? [],
        deleted: deploymentDetails.deleted_data_connector_names ?? [],
      },
    });
  }

  const deploymentChanges = {
    pipes: {
      changed: deploymentDetails.changed_pipe_names ?? [],
      created: deploymentDetails.new_pipe_names ?? [],
      deleted: deploymentDetails.deleted_pipe_names ?? [],
    },
    datasources: {
      changed: deploymentDetails.changed_datasource_names ?? [],
      created: deploymentDetails.new_datasource_names ?? [],
      deleted: deploymentDetails.deleted_datasource_names ?? [],
    },
  };

  // If we're not waiting, return as soon as the server accepted the deployment.
  if (!wait) {
    options?.callbacks?.onDeploymentSubmitted?.(deploymentId);
    return {
      success: true,
      result: "success",
      datasourceCount: resources.datasources.length,
      pipeCount: resources.pipes.length,
      connectionCount: resources.connections?.length ?? 0,
      buildId: deploymentId,
      ...deploymentChanges,
    };
  }

  // Step 2: Poll until the deployment reaches a terminal state.
  let deployment = body.deployment;
  let timesSeenFailed = 0;
  let notifiedReady = false;
  let notifiedWaitingForPromote = false;

  options?.callbacks?.onWaitingForReady?.();

  const isDone = (): boolean => {
    if (deployment.status !== "data_ready") {
      return false;
    }
    if (auto) {
      // When auto-promoting we must also wait for the server to flip it live.
      return deployment.live === true;
    }
    return true;
  };

  const buildError = (message: string): BuildApiResult => ({
    success: false,
    result: "failed",
    error: message,
    datasourceCount: resources.datasources.length,
    pipeCount: resources.pipes.length,
    connectionCount: resources.connections?.length ?? 0,
    buildId: deploymentId,
  });

  while (!isDone()) {
    await sleep(POLL_INTERVAL_MS);

    if (debug) {
      console.log(`[debug] Polling deployment status...`);
    }

    const statusUrl = `${baseUrl}/v1/deployments/${deploymentId}`;
    const statusResponse = await tinybirdFetch(statusUrl, {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    });

    if (!statusResponse.ok) {
      return buildError(
        `Failed to check deployment status: ${statusResponse.status} ${statusResponse.statusText}`
      );
    }

    const statusBody = (await statusResponse.json()) as DeploymentStatusResponse;
    deployment = statusBody.deployment;

    if (debug) {
      console.log(
        `[debug] Deployment status: ${deployment.status} (live=${deployment.live ?? false})`
      );
    }

    if (deployment.status === "failed") {
      timesSeenFailed++;
      if (timesSeenFailed > MAX_CONSECUTIVE_FAILED_POLLS) {
        return buildError(
          "Deployment failed to create and didn't start deleting automatically after 5 minutes. " +
            "You might need to delete it manually in the UI."
        );
      }
      continue;
    }

    if (deployment.status === "deleting" || deployment.status === "deleted") {
      const errors = deployment.feedback
        ?.filter((f) => f.level === "ERROR")
        .map((f) => f.message)
        .join("\n");
      const errorSuffix = errors ? `\n${errors}` : "";
      return buildError(
        `Deployment failed and ${
          deployment.status === "deleting" ? "is being" : "was"
        } deleted automatically.${errorSuffix}`
      );
    }

    if (
      auto &&
      deployment.status === "data_ready" &&
      !deployment.live &&
      !notifiedWaitingForPromote
    ) {
      if (!notifiedReady) {
        options?.callbacks?.onDeploymentReady?.();
        notifiedReady = true;
      }
      options?.callbacks?.onWaitingForPromote?.();
      notifiedWaitingForPromote = true;
    }
  }

  if (!notifiedReady) {
    options?.callbacks?.onDeploymentReady?.();
    notifiedReady = true;
  }

  if (auto) {
    if (debug) {
      console.log(`[debug] Deployment ${deploymentId} is now live`);
    }
    options?.callbacks?.onDeploymentPromoted?.();
    options?.callbacks?.onDeploymentLive?.(deploymentId);
  }

  return {
    success: true,
    result: "success",
    datasourceCount: resources.datasources.length,
    pipeCount: resources.pipes.length,
    connectionCount: resources.connections?.length ?? 0,
    buildId: deploymentId,
    ...deploymentChanges,
  };
}

/**
 * Helper function to sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDeployErrorMessage(message: string): string {
  const trimmedMessage = message.trim();
  const isForwardClassicError =
    trimmedMessage.includes("Tinybird Forward workspace") &&
    trimmedMessage.includes("Tinybird Classic workspaces");

  if (!isForwardClassicError || trimmedMessage.includes(FORWARD_CLASSIC_GUIDANCE)) {
    return message;
  }

  return `${trimmedMessage}\n${FORWARD_CLASSIC_GUIDANCE}`;
}
