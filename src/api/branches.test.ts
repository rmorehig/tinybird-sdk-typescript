import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BranchApiError,
  createBranch,
  listBranches,
  getBranch,
  deleteBranch,
  branchExists,
  getOrCreateBranch,
  clearBranch,
  type BranchApiConfig,
} from "./branches.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

function expectFromParam(url: string) {
  const parsed = new URL(url);
  expect(parsed.searchParams.get("from")).toBe("ts-sdk");
  return parsed;
}

describe("Branch API client", () => {
  const config: BranchApiConfig = {
    baseUrl: "https://api.tinybird.co",
    token: "p.test-token",
  };

  beforeEach(() => {
    mockFetch.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createBranch", () => {
    it("creates a branch and returns it", async () => {
      const mockBranch = {
        id: "branch-123",
        name: "my-feature",
        token: "p.branch-token",
        created_at: "2024-01-01T00:00:00Z",
      };

      // 1. POST to /v1/environments returns a job
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          job: { id: "job-123", status: "waiting" },
          workspace: { id: "ws-123" },
        }),
      });

      // 2. Poll job - returns done
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "job-123", status: "done" }),
      });

      // 3. Get branch with token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockBranch),
      });

      const result = await createBranch(config, "my-feature");

      expect(mockFetch).toHaveBeenCalledTimes(3);
      const [createUrl, createInit] = mockFetch.mock.calls[0];
      const createParsed = expectFromParam(createUrl);
      expect(createParsed.pathname).toBe("/v1/environments");
      expect(createParsed.searchParams.get("name")).toBe("my-feature");
      expect(createInit).toEqual({
        method: "POST",
        headers: {
          Authorization: "Bearer p.test-token",
        },
      });

      const [jobUrl, jobInit] = mockFetch.mock.calls[1];
      const jobParsed = expectFromParam(jobUrl);
      expect(jobParsed.pathname).toBe("/v0/jobs/job-123");
      expect(jobInit).toEqual({
        method: "GET",
        headers: {
          Authorization: "Bearer p.test-token",
        },
      });

      const [branchUrl, branchInit] = mockFetch.mock.calls[2];
      const branchParsed = expectFromParam(branchUrl);
      expect(branchParsed.pathname).toBe("/v0/environments/my-feature");
      expect(branchParsed.searchParams.get("with_token")).toBe("true");
      expect(branchInit).toEqual({
        method: "GET",
        headers: {
          Authorization: "Bearer p.test-token",
        },
      });
      expect(result).toEqual(mockBranch);
    });

    it("polls job until done", async () => {
      const mockBranch = {
        id: "branch-123",
        name: "my-feature",
        token: "p.branch-token",
        created_at: "2024-01-01T00:00:00Z",
      };

      // 1. POST to /v1/environments returns a job
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          job: { id: "job-123", status: "waiting" },
          workspace: { id: "ws-123" },
        }),
      });

      // 2. Poll job - waiting
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "job-123", status: "waiting" }),
      });

      // 3. Poll job - working
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "job-123", status: "working" }),
      });

      // 4. Poll job - done
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "job-123", status: "done" }),
      });

      // 5. Get branch with token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockBranch),
      });

      // Start the async operation
      const promise = createBranch(config, "my-feature");

      // Advance timers and run all pending promises
      await vi.runAllTimersAsync();

      const result = await promise;

      expect(mockFetch).toHaveBeenCalledTimes(5);
      expect(result).toEqual(mockBranch);
    });

    it("throws BranchApiError on job error", async () => {
      // 1. POST to /v1/environments returns a job
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          job: { id: "job-123", status: "waiting" },
        }),
      });

      // 2. Poll job - error
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "job-123", status: "error", error: "Something went wrong" }),
      });

      await expect(createBranch(config, "my-feature")).rejects.toThrow(
        BranchApiError
      );
    });

    it("throws BranchApiError on failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: () => Promise.resolve("Branch already exists"),
      });

      await expect(createBranch(config, "existing")).rejects.toThrow(
        BranchApiError
      );
    });

    it("uses last_partition=1 wire format when option is enabled", async () => {
      const mockBranch = {
        id: "branch-123",
        name: "my-feature",
        token: "p.branch-token",
        created_at: "2024-01-01T00:00:00Z",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          job: { id: "job-123", status: "waiting" },
          workspace: { id: "ws-123" },
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "job-123", status: "done" }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockBranch),
      });

      await createBranch(config, "my-feature", { lastPartition: true });

      const [createUrl] = mockFetch.mock.calls[0];
      const createParsed = expectFromParam(createUrl);
      expect(createParsed.searchParams.get("name")).toBe("my-feature");
      expect(createParsed.searchParams.get("last_partition")).toBe("1");
    });

    it("uses custom fetch when provided", async () => {
      const customFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              job: { id: "job-123", status: "waiting" },
              workspace: { id: "ws-123" },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: "job-123", status: "done" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: "branch-123",
              name: "my-feature",
              token: "p.branch-token",
              created_at: "2024-01-01T00:00:00Z",
            }),
        });

      const result = await createBranch(
        {
          ...config,
          fetch: customFetch as typeof fetch,
        },
        "my-feature"
      );

      expect(customFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.token).toBe("p.branch-token");
    });
  });

  describe("listBranches", () => {
    it("returns array of branches", async () => {
      const mockBranches = [
        { id: "1", name: "feature-a", created_at: "2024-01-01T00:00:00Z" },
        { id: "2", name: "feature-b", created_at: "2024-01-02T00:00:00Z" },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ environments: mockBranches }),
      });

      const result = await listBranches(config);

      const [url, init] = mockFetch.mock.calls[0];
      const parsed = expectFromParam(url);
      expect(parsed.pathname).toBe("/v1/environments");
      expect(init).toEqual({
        method: "GET",
        headers: {
          Authorization: "Bearer p.test-token",
        },
      });
      expect(result).toEqual(mockBranches);
    });

    it("returns empty array when no branches", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ environments: undefined }),
      });

      const result = await listBranches(config);
      expect(result).toEqual([]);
    });
  });

  describe("getBranch", () => {
    it("returns branch with token", async () => {
      const mockBranch = {
        id: "branch-123",
        name: "my-feature",
        token: "p.branch-token",
        created_at: "2024-01-01T00:00:00Z",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockBranch),
      });

      const result = await getBranch(config, "my-feature");

      const [url, init] = mockFetch.mock.calls[0];
      const parsed = expectFromParam(url);
      expect(parsed.pathname).toBe("/v0/environments/my-feature");
      expect(parsed.searchParams.get("with_token")).toBe("true");
      expect(init).toEqual({
        method: "GET",
        headers: {
          Authorization: "Bearer p.test-token",
        },
      });
      expect(result).toEqual(mockBranch);
    });

    it("throws BranchApiError when branch not found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve("Branch not found"),
      });

      await expect(getBranch(config, "nonexistent")).rejects.toThrow(
        BranchApiError
      );
    });
  });

  describe("deleteBranch", () => {
    it("deletes a branch successfully", async () => {
      const mockBranch = {
        id: "branch-123",
        name: "my-feature",
        token: "p.branch-token",
        created_at: "2024-01-01T00:00:00Z",
      };

      // 1. getBranch to get the ID
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockBranch),
      });

      // 2. DELETE the branch by ID
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await deleteBranch(config, "my-feature");

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // First call: get branch
      const [getUrl, getInit] = mockFetch.mock.calls[0];
      const getParsed = expectFromParam(getUrl);
      expect(getParsed.pathname).toBe("/v0/environments/my-feature");
      expect(getInit.method).toBe("GET");

      // Second call: delete branch by ID
      const [deleteUrl, deleteInit] = mockFetch.mock.calls[1];
      const deleteParsed = expectFromParam(deleteUrl);
      expect(deleteParsed.pathname).toBe("/v0/environments/branch-123");
      expect(deleteInit).toEqual({
        method: "DELETE",
        headers: {
          Authorization: "Bearer p.test-token",
        },
      });
    });
  });

  describe("branchExists", () => {
    it("returns true when branch exists", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            environments: [
              { id: "1", name: "my-feature", created_at: "2024-01-01" },
            ],
          }),
      });

      const result = await branchExists(config, "my-feature");
      expect(result).toBe(true);
    });

    it("returns false when branch does not exist", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ environments: [] }),
      });

      const result = await branchExists(config, "nonexistent");
      expect(result).toBe(false);
    });

    it("throws on API error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(branchExists(config, "any")).rejects.toThrow("Network error");
    });
  });

  describe("getOrCreateBranch", () => {
    it("returns existing branch if found", async () => {
      const mockBranch = {
        id: "branch-123",
        name: "existing-feature",
        token: "p.branch-token",
        created_at: "2024-01-01T00:00:00Z",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockBranch),
      });

      const result = await getOrCreateBranch(config, "existing-feature");
      expect(result).toEqual({ ...mockBranch, wasCreated: false });
    });

    it("creates branch if not found", async () => {
      const newBranch = {
        id: "branch-456",
        name: "new-feature",
        token: "p.new-token",
        created_at: "2024-01-02T00:00:00Z",
      };

      // 1. getBranch returns 404
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve("Not found"),
      });

      // 2. createBranch: POST to /v1/environments returns a job
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          job: { id: "job-456", status: "waiting" },
          workspace: { id: "ws-456" },
        }),
      });

      // 3. Poll job - done
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "job-456", status: "done" }),
      });

      // 4. Get branch with token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(newBranch),
      });

      const result = await getOrCreateBranch(config, "new-feature");
      expect(result).toEqual({ ...newBranch, wasCreated: true });
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe("clearBranch", () => {
    it("clears a branch by deleting and recreating it", async () => {
      const existingBranch = {
        id: "branch-old",
        name: "my-feature",
        token: "p.old-token",
        created_at: "2024-01-01T00:00:00Z",
      };

      const newBranch = {
        id: "branch-new",
        name: "my-feature",
        token: "p.new-token",
        created_at: "2024-01-02T00:00:00Z",
      };

      // 1. GET branch to get ID (for delete)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(existingBranch),
      });

      // 2. DELETE branch by ID
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      // 3. POST to /v1/environments returns a job
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          job: { id: "job-789", status: "waiting" },
          workspace: { id: "ws-789" },
        }),
      });

      // 4. Poll job - done
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "job-789", status: "done" }),
      });

      // 5. Get branch with token (after create)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(newBranch),
      });

      const result = await clearBranch(config, "my-feature");

      expect(mockFetch).toHaveBeenCalledTimes(5);

      // Verify get was called first
      const [getUrl, getInit] = mockFetch.mock.calls[0];
      const getParsed = expectFromParam(getUrl);
      expect(getParsed.pathname).toBe("/v0/environments/my-feature");
      expect(getInit.method).toBe("GET");

      // Verify delete was called with ID
      const [deleteUrl, deleteInit] = mockFetch.mock.calls[1];
      const deleteParsed = expectFromParam(deleteUrl);
      expect(deleteParsed.pathname).toBe("/v0/environments/branch-old");
      expect(deleteInit.method).toBe("DELETE");

      // Verify create was called
      const [createUrl, createInit] = mockFetch.mock.calls[2];
      const createParsed = expectFromParam(createUrl);
      expect(createParsed.pathname).toBe("/v1/environments");
      expect(createParsed.searchParams.get("name")).toBe("my-feature");
      expect(createInit.method).toBe("POST");

      expect(result).toEqual(newBranch);
    });

    it("throws BranchApiError when branch does not exist", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve("Branch not found"),
      });

      await expect(clearBranch(config, "nonexistent")).rejects.toThrow(
        BranchApiError
      );
    });
  });
});
