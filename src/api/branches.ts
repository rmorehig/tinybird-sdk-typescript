/**
 * Tinybird Branch (Environment) API client
 * Uses the /v1/environments endpoints (Forward API)
 */

import { createTinybirdFetcher } from "./fetcher.js";

/**
 * Branch information from Tinybird API
 */
export interface TinybirdBranch {
  /** Branch ID */
  id: string;
  /** Branch name */
  name: string;
  /** Branch token (only present when requested with with_token=true) */
  token?: string;
  /** When the branch was created */
  created_at: string;
}

/**
 * Result of getOrCreateBranch operation
 */
export interface GetOrCreateBranchResult extends TinybirdBranch {
  /** Whether the branch was newly created (vs already existed) */
  wasCreated: boolean;
}

/**
 * API configuration for branch operations
 */
export interface BranchApiConfig {
  /** Tinybird API base URL */
  baseUrl: string;
  /** Parent workspace token (used to create/manage branches) */
  token: string;
  /** Custom fetch implementation (optional) */
  fetch?: typeof fetch;
}

function getFetch(config: BranchApiConfig) {
  return createTinybirdFetcher(config.fetch ?? globalThis.fetch);
}

/**
 * Job response from async operations
 */
interface JobResponse {
  job: {
    id: string;
    status: string;
    job_url?: string;
  };
  workspace?: {
    id: string;
  };
}

/**
 * Job status response
 */
interface JobStatusResponse {
  id: string;
  status: "waiting" | "working" | "done" | "error";
  error?: string;
}

/**
 * Error thrown by branch API operations
 */
export class BranchApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "BranchApiError";
  }
}

/**
 * Poll a job until it completes
 *
 * @param config - API configuration
 * @param jobId - Job ID to poll
 * @param maxAttempts - Maximum polling attempts (default: 120, i.e. 2 minutes)
 * @param intervalMs - Polling interval in milliseconds (default: 1000)
 * @returns Job status when complete
 */
async function pollJob(
  config: BranchApiConfig,
  jobId: string,
  maxAttempts = 120,
  intervalMs = 1000
): Promise<JobStatusResponse> {
  const fetchFn = getFetch(config);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const url = new URL(`/v0/jobs/${jobId}`, config.baseUrl);

    const response = await fetchFn(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new BranchApiError(
        `Failed to poll job '${jobId}': ${response.status} ${response.statusText}\nAPI response: ${body}`,
        response.status,
        body
      );
    }

    const jobStatus = (await response.json()) as JobStatusResponse;

    if (jobStatus.status === "done") {
      return jobStatus;
    }

    if (jobStatus.status === "error") {
      throw new BranchApiError(
        `Job '${jobId}' failed: ${jobStatus.error ?? "Unknown error"}`,
        500,
        jobStatus
      );
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new BranchApiError(
    `Job '${jobId}' timed out after ${maxAttempts} attempts`,
    408
  );
}

/**
 * Create a new branch
 * POST /v1/environments?name={name}
 *
 * This is an async operation that returns a job. We poll the job until
 * it completes, then fetch the branch with its token.
 *
 * @param config - API configuration
 * @param name - Branch name to create
 * @returns The created branch with token
 */
export interface CreateBranchOptions {
  /** Copy the last partition of production data into the branch */
  lastPartition?: boolean;
}

export async function createBranch(
  config: BranchApiConfig,
  name: string,
  options?: CreateBranchOptions
): Promise<TinybirdBranch> {
  const fetchFn = getFetch(config);
  const url = new URL("/v1/environments", config.baseUrl);
  url.searchParams.set("name", name);
  if (options?.lastPartition) {
    url.searchParams.set("last_partition", "1");
  }

  const debug = !!process.env.TINYBIRD_DEBUG;
  if (debug) {
    console.log(`[debug] POST ${url.toString()}`);
  }

  const response = await fetchFn(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();

    // Provide helpful error message for common cases, but include raw response for debugging
    let message = `Failed to create branch '${name}': ${response.status} ${response.statusText}`;
    if (response.status === 403) {
      message = `Permission denied creating branch '${name}'. ` +
        `Make sure TINYBIRD_TOKEN is a workspace admin token (not a branch token). ` +
        `Branch tokens cannot create new branches.\n` +
        `API response: ${body}`;
    } else if (response.status === 409) {
      message = `Branch '${name}' already exists.`;
    } else {
      message += `\nAPI response: ${body}`;
    }

    throw new BranchApiError(message, response.status, body);
  }

  // Parse the job response
  const jobResponse = (await response.json()) as JobResponse;

  if (!jobResponse.job?.id) {
    throw new BranchApiError(
      `Unexpected response from branch creation: no job ID returned`,
      500,
      jobResponse
    );
  }

  // Poll the job until it completes
  await pollJob(config, jobResponse.job.id);

  // Now fetch the branch with its token using the branch name
  const branch = await getBranch(config, name);
  return branch;
}

/**
 * List all branches in the workspace
 * GET /v1/environments
 *
 * @param config - API configuration
 * @returns Array of branches
 */
export async function listBranches(
  config: BranchApiConfig
): Promise<TinybirdBranch[]> {
  const fetchFn = getFetch(config);
  const url = new URL("/v1/environments", config.baseUrl);

  const response = await fetchFn(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new BranchApiError(
      `Failed to list branches: ${response.status} ${response.statusText}`,
      response.status,
      body
    );
  }

  const data = (await response.json()) as { environments: TinybirdBranch[] };
  return data.environments ?? [];
}

/**
 * Get a branch by name with its token
 * GET /v0/environments/{name}?with_token=true
 *
 * @param config - API configuration
 * @param name - Branch name
 * @returns Branch with token
 */
export async function getBranch(
  config: BranchApiConfig,
  name: string
): Promise<TinybirdBranch> {
  const fetchFn = getFetch(config);
  const url = new URL(`/v0/environments/${encodeURIComponent(name)}`, config.baseUrl);
  url.searchParams.set("with_token", "true");

  const response = await fetchFn(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new BranchApiError(
      `Failed to get branch '${name}': ${response.status} ${response.statusText}`,
      response.status,
      body
    );
  }

  const data = (await response.json()) as TinybirdBranch;
  return data;
}

/**
 * Delete a branch
 * DELETE /v0/environments/{id}
 *
 * Note: The API requires the branch ID, not name. This function first
 * fetches the branch to get its ID, then deletes it.
 *
 * @param config - API configuration
 * @param name - Branch name to delete
 */
export async function deleteBranch(
  config: BranchApiConfig,
  name: string
): Promise<void> {
  // First get the branch to find its ID
  const branch = await getBranch(config, name);
  const fetchFn = getFetch(config);

  const url = new URL(`/v0/environments/${branch.id}`, config.baseUrl);

  const response = await fetchFn(url.toString(), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new BranchApiError(
      `Failed to delete branch '${name}': ${response.status} ${response.statusText}`,
      response.status,
      body
    );
  }
}

/**
 * Check if a branch exists
 *
 * @param config - API configuration
 * @param name - Branch name to check
 * @returns true if branch exists, false if not
 * @throws BranchApiError on API/network/auth failures
 */
export async function branchExists(
  config: BranchApiConfig,
  name: string
): Promise<boolean> {
  const branches = await listBranches(config);
  return branches.some((b) => b.name === name);
}

/**
 * Get or create a branch
 * If the branch exists, returns it with token.
 * If it doesn't exist, creates it.
 *
 * @param config - API configuration
 * @param name - Branch name
 * @returns Branch with token
 */
export async function getOrCreateBranch(
  config: BranchApiConfig,
  name: string,
  options?: CreateBranchOptions
): Promise<GetOrCreateBranchResult> {
  // First try to get the existing branch
  try {
    const branch = await getBranch(config, name);
    return { ...branch, wasCreated: false };
  } catch (error) {
    // If it's a 404, create the branch
    if (error instanceof BranchApiError && error.status === 404) {
      const branch = await createBranch(config, name, options);
      return { ...branch, wasCreated: true };
    }
    throw error;
  }
}

/**
 * Clear a branch by deleting and recreating it
 *
 * @param config - API configuration
 * @param name - Branch name to clear
 * @returns The recreated branch with token
 */
export async function clearBranch(
  config: BranchApiConfig,
  name: string,
  options?: CreateBranchOptions
): Promise<TinybirdBranch> {
  // Delete the branch
  await deleteBranch(config, name);

  // Recreate the branch
  const branch = await createBranch(config, name, options);

  return branch;
}
