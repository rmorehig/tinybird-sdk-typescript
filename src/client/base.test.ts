import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TinybirdClient, createClient } from "./base.js";
import type { DatasourcesNamespace } from "./types.js";
import { loadConfigAsync } from "../cli/config.js";
import { getOrCreateBranch } from "../api/branches.js";

vi.mock("../cli/config.js", () => ({
  loadConfigAsync: vi.fn(),
}));

vi.mock("../api/branches.js", () => ({
  getOrCreateBranch: vi.fn(),
}));

describe("TinybirdClient", () => {
  const originalEnv = { ...process.env };
  const mockedLoadConfigAsync = vi.mocked(loadConfigAsync);
  const mockedGetOrCreateBranch = vi.mocked(getOrCreateBranch);

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.VERCEL_ENV;
    delete process.env.GITHUB_HEAD_REF;
    delete process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME;
    delete process.env.CI;
    delete process.env.TINYBIRD_PREVIEW_MODE;
    delete process.env.VERCEL_GIT_COMMIT_REF;
    delete process.env.GITHUB_REF_NAME;
    delete process.env.CI_COMMIT_BRANCH;
    delete process.env.CIRCLE_BRANCH;
    delete process.env.BUILD_SOURCEBRANCHNAME;
    delete process.env.BITBUCKET_BRANCH;
    delete process.env.TINYBIRD_BRANCH_NAME;
    delete process.env.TINYBIRD_BRANCH_TOKEN;
    mockedLoadConfigAsync.mockReset();
    mockedGetOrCreateBranch.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("throws error when baseUrl is missing", () => {
      expect(() => new TinybirdClient({ baseUrl: "", token: "test-token" })).toThrow(
        "baseUrl is required"
      );
    });

    it("throws error when token is missing", () => {
      expect(
        () => new TinybirdClient({ baseUrl: "https://api.tinybird.co", token: "" })
      ).toThrow("token is required");
    });

    it("creates client with valid config", () => {
      const client = new TinybirdClient({
        baseUrl: "https://api.tinybird.co",
        token: "test-token",
      });
      expect(client).toBeInstanceOf(TinybirdClient);
    });

    it("normalizes baseUrl by removing trailing slash", async () => {
      const client = new TinybirdClient({
        baseUrl: "https://api.tinybird.co/",
        token: "test-token",
      });
      const context = await client.getContext();
      expect(context.baseUrl).toBe("https://api.tinybird.co");
    });
  });

  describe("getContext", () => {
    it("returns correct context in non-devMode", async () => {
      const client = new TinybirdClient({
        baseUrl: "https://api.tinybird.co",
        token: "test-token",
      });

      const context = await client.getContext();

      expect(context).toEqual({
        token: "test-token",
        baseUrl: "https://api.tinybird.co",
        devMode: false,
        isBranchToken: false,
        branchName: null,
        gitBranch: null,
      });
    });

    it("returns devMode: false when devMode is not set", async () => {
      const client = new TinybirdClient({
        baseUrl: "https://api.tinybird.co",
        token: "test-token",
      });

      const context = await client.getContext();
      expect(context.devMode).toBe(false);
    });

    it("returns isBranchToken: false when not in devMode", async () => {
      const client = new TinybirdClient({
        baseUrl: "https://api.tinybird.co",
        token: "test-token",
      });

      const context = await client.getContext();
      expect(context.isBranchToken).toBe(false);
    });

    it("returns branchName: null when not in devMode", async () => {
      const client = new TinybirdClient({
        baseUrl: "https://api.tinybird.co",
        token: "test-token",
      });

      const context = await client.getContext();
      expect(context.branchName).toBeNull();
    });

    it("returns gitBranch: null when not in devMode", async () => {
      const client = new TinybirdClient({
        baseUrl: "https://api.tinybird.co",
        token: "test-token",
      });

      const context = await client.getContext();
      expect(context.gitBranch).toBeNull();
    });

    it("caches the resolved context", async () => {
      const client = new TinybirdClient({
        baseUrl: "https://api.tinybird.co",
        token: "test-token",
      });

      const context1 = await client.getContext();
      const context2 = await client.getContext();

      expect(context1).toBe(context2);
    });

    it("works with different baseUrl regions", async () => {
      const client = new TinybirdClient({
        baseUrl: "https://api.us-east.tinybird.co",
        token: "us-token",
      });

      const context = await client.getContext();
      expect(context.baseUrl).toBe("https://api.us-east.tinybird.co");
      expect(context.token).toBe("us-token");
    });

    it("passes custom fetch to devMode branch resolution", async () => {
      const customFetch = vi.fn();

      mockedLoadConfigAsync.mockResolvedValue({
        include: [],
        token: "workspace-token",
        baseUrl: "https://api.tinybird.co",
        configPath: "/tmp/tinybird.config.json",
        cwd: "/tmp",
        gitBranch: "feature/add-fetch",
        tinybirdBranch: "feature_add_fetch",
        isMainBranch: false,
        devMode: "branch",
        branchDataOnCreate: null,
      });
      mockedGetOrCreateBranch.mockResolvedValue({
        id: "branch-123",
        name: "feature_add_fetch",
        token: "branch-token",
        created_at: "2024-01-01T00:00:00Z",
        wasCreated: false,
      });

      const client = new TinybirdClient({
        baseUrl: "https://api.tinybird.co",
        token: "workspace-token",
        fetch: customFetch as typeof fetch,
        devMode: true,
      });

      const context = await client.getContext();

      expect(mockedLoadConfigAsync).toHaveBeenCalled();
      expect(mockedGetOrCreateBranch).toHaveBeenCalledWith(
        {
          baseUrl: "https://api.tinybird.co",
          token: "workspace-token",
          fetch: customFetch,
        },
        "feature_add_fetch"
      );
      expect(context.token).toBe("branch-token");
      expect(context.isBranchToken).toBe(true);
      expect(context.branchName).toBe("feature_add_fetch");
      expect(context.gitBranch).toBe("feature/add-fetch");
    });
  });

  describe("createClient", () => {
    it("creates a TinybirdClient instance", () => {
      const client = createClient({
        baseUrl: "https://api.tinybird.co",
        token: "test-token",
      });

      expect(client).toBeInstanceOf(TinybirdClient);
    });

    it("passes config to the client correctly", async () => {
      const client = createClient({
        baseUrl: "https://api.tinybird.co",
        token: "my-token",
      });

      const context = await client.getContext();
      expect(context.token).toBe("my-token");
      expect(context.baseUrl).toBe("https://api.tinybird.co");
    });
  });

  describe("datasources", () => {
    it("exposes datasources namespace", () => {
      const client = createClient({
        baseUrl: "https://api.tinybird.co",
        token: "test-token",
      });

      expect(client.datasources).toBeDefined();
    });

    it("datasources namespace has ingest/append/replace/delete/truncate methods", () => {
      const client = createClient({
        baseUrl: "https://api.tinybird.co",
        token: "test-token",
      });

      expect(typeof client.datasources.ingest).toBe("function");
      expect(typeof client.datasources.append).toBe("function");
      expect(typeof client.datasources.replace).toBe("function");
      expect(typeof client.datasources.delete).toBe("function");
      expect(typeof client.datasources.truncate).toBe("function");
    });

    it("datasources conforms to DatasourcesNamespace interface", () => {
      const client = createClient({
        baseUrl: "https://api.tinybird.co",
        token: "test-token",
      });

      const datasources: DatasourcesNamespace = client.datasources;
      expect(datasources).toBeDefined();
      expect(typeof datasources.ingest).toBe("function");
      expect(typeof datasources.append).toBe("function");
      expect(typeof datasources.replace).toBe("function");
      expect(typeof datasources.delete).toBe("function");
      expect(typeof datasources.truncate).toBe("function");
    });
  });
});
