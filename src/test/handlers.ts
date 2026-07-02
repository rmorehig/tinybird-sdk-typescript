/**
 * MSW handlers for API mocking in tests
 */

import { http, HttpResponse } from "msw";

export const BASE_URL = "https://api.tinybird.co";

/**
 * Create build success response
 */
export function createBuildSuccessResponse(options?: {
  buildId?: string;
  changedPipes?: string[];
  newPipes?: string[];
  deletedPipes?: string[];
  changedDatasources?: string[];
  newDatasources?: string[];
  deletedDatasources?: string[];
}) {
  return {
    result: "success",
    build: {
      id: options?.buildId ?? "build-123",
      changed_pipe_names: options?.changedPipes ?? [],
      new_pipe_names: options?.newPipes ?? [],
      deleted_pipe_names: options?.deletedPipes ?? [],
      changed_datasource_names: options?.changedDatasources ?? [],
      new_datasource_names: options?.newDatasources ?? [],
      deleted_datasource_names: options?.deletedDatasources ?? [],
    },
  };
}

/**
 * Create build failure response
 */
export function createBuildFailureResponse(error: string) {
  return {
    result: "failed",
    error,
  };
}

/**
 * Create build failure response with multiple errors
 */
export function createBuildMultipleErrorsResponse(
  errors: Array<{ filename?: string; error: string }>
) {
  return {
    result: "failed",
    errors,
  };
}

/**
 * Create no changes response
 */
export function createNoChangesResponse() {
  return {
    result: "no_changes",
  };
}

/**
 * Create deploy success response (for /v1/deploy endpoint)
 * This returns a deployment object, not a build object
 */
export function createDeploySuccessResponse(options?: {
  deploymentId?: string;
  status?: string;
}) {
  return {
    result: "success",
    deployment: {
      id: options?.deploymentId ?? "deploy-123",
      status: options?.status ?? "pending",
    },
  };
}

/**
 * Create deployment status response (for /v1/deployments/:id endpoint)
 */
export function createDeploymentStatusResponse(options?: {
  deploymentId?: string;
  status?: string;
  live?: boolean;
}) {
  const status = options?.status ?? "data_ready";
  return {
    result: "success",
    deployment: {
      id: options?.deploymentId ?? "deploy-123",
      status,
      // When the deployment is `data_ready` the default assumes the server
      // has already auto-promoted it, which is what most tests exercise.
      live: options?.live ?? status === "data_ready",
    },
  };
}

/**
 * Create deployments list response (for /v1/deployments endpoint)
 */
export function createDeploymentsListResponse(options?: {
  deployments?: Array<{ id: string; status: string; live: boolean }>;
}) {
  return {
    deployments: options?.deployments ?? [],
  };
}

/**
 * Default handlers for build and deploy endpoints
 */
export const handlers = [
  // Build endpoint - success by default
  http.post(`${BASE_URL}/v1/build`, () => {
    return HttpResponse.json(createBuildSuccessResponse());
  }),

  // Deploy endpoint - success by default
  http.post(`${BASE_URL}/v1/deploy`, () => {
    return HttpResponse.json(createBuildSuccessResponse());
  }),

  // Deployments list endpoint - empty list by default (no stale deployments)
  http.get(`${BASE_URL}/v1/deployments`, () => {
    return HttpResponse.json(createDeploymentsListResponse());
  }),
];
