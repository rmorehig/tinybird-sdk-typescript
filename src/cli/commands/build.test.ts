import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runBuild } from "./build.js";
import { BranchDataOnCreate } from "../config-types.js";

// Mock all dependencies
vi.mock("../config.js", () => ({
  loadConfigAsync: vi.fn(),
  LOCAL_BASE_URL: "http://localhost:7181",
}));

vi.mock("../../generator/index.js", () => ({
  buildFromInclude: vi.fn(),
}));

vi.mock("../../api/build.js", () => ({
  buildToTinybird: vi.fn(),
}));

vi.mock("../../api/branches.js", () => ({
  getOrCreateBranch: vi.fn(),
}));

vi.mock("../../api/local.js", () => ({
  getLocalTokens: vi.fn(),
  getOrCreateLocalWorkspace: vi.fn(),
  getLocalWorkspaceName: vi.fn(),
  LocalNotRunningError: class LocalNotRunningError extends Error {},
}));

vi.mock("../../api/workspaces.js", () => ({
  getWorkspace: vi.fn(),
}));

vi.mock("../../api/dashboard.js", () => ({
  getBranchDashboardUrl: vi.fn(),
  getLocalDashboardUrl: vi.fn(),
}));

describe("Build Command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("devModeOverride", () => {
    it("uses local mode when devModeOverride is 'local'", async () => {
      const { loadConfigAsync } = await import("../config.js");
      const { buildFromInclude } = await import("../../generator/index.js");
      const { getLocalTokens, getOrCreateLocalWorkspace, getLocalWorkspaceName } = await import("../../api/local.js");
      const { buildToTinybird } = await import("../../api/build.js");
      const { getWorkspace } = await import("../../api/workspaces.js");
      const { getLocalDashboardUrl } = await import("../../api/dashboard.js");

      // Config has devMode: "branch" but we override with "local"
      vi.mocked(loadConfigAsync).mockResolvedValue({
        include: ["test.ts"],
        token: "p.test-token",
        baseUrl: "https://api.tinybird.co",
        configPath: "/test/tinybird.config.json",
        devMode: "branch", // Config says branch
        cwd: "/test",
        gitBranch: "feature-test",
        tinybirdBranch: "feature_test",
        isMainBranch: false,
        branchDataOnCreate: null,
      });

      vi.mocked(buildFromInclude).mockResolvedValue({
        resources: {
          datasources: [],
          pipes: [],
          connections: [],
        },
        entities: {
          datasources: {},
          pipes: {},
          connections: {},
          rawDatasources: [],
          rawPipes: [],
          sourceFiles: [],
        },
        stats: {
          datasourceCount: 0,
          pipeCount: 0,
          connectionCount: 0,
        },
      });

      vi.mocked(getLocalTokens).mockResolvedValue({
        admin_token: "admin-token",
        user_token: "user-token",
        workspace_admin_token: "workspace-admin-token",
      });

      vi.mocked(getWorkspace).mockResolvedValue({
        id: "ws-id",
        name: "test-workspace",
        user_id: "user-id",
        user_email: "user@test.com",
        scope: "USER",
        main: null,
      });

      vi.mocked(getLocalWorkspaceName).mockReturnValue("feature_test_workspace");

      vi.mocked(getOrCreateLocalWorkspace).mockResolvedValue({
        workspace: { id: "local-ws-id", name: "feature_test_workspace", token: "local-token" },
        wasCreated: false,
      });

      vi.mocked(getLocalDashboardUrl).mockReturnValue("http://localhost:7181/dashboard");

      vi.mocked(buildToTinybird).mockResolvedValue({
        success: true,
        result: "success",
        datasourceCount: 0,
        pipeCount: 0,
        connectionCount: 0,
      });

      const result = await runBuild({
        devModeOverride: "local", // Override to local
      });

      expect(result.success).toBe(true);
      expect(result.branchInfo?.isLocal).toBe(true);
      // Verify local APIs were called
      expect(getLocalTokens).toHaveBeenCalled();
      expect(getOrCreateLocalWorkspace).toHaveBeenCalled();
      // Verify buildToTinybird was called with local URL
      expect(buildToTinybird).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "http://localhost:7181",
        }),
        expect.anything()
      );
    });

    it("uses branch mode when devModeOverride is 'branch'", async () => {
      const { loadConfigAsync } = await import("../config.js");
      const { buildFromInclude } = await import("../../generator/index.js");
      const { getOrCreateBranch } = await import("../../api/branches.js");
      const { buildToTinybird } = await import("../../api/build.js");
      const { getWorkspace } = await import("../../api/workspaces.js");
      const { getBranchDashboardUrl } = await import("../../api/dashboard.js");

      // Config has devMode: "local" but we override with "branch"
      vi.mocked(loadConfigAsync).mockResolvedValue({
        include: ["test.ts"],
        token: "p.test-token",
        baseUrl: "https://api.tinybird.co",
        configPath: "/test/tinybird.config.json",
        devMode: "local", // Config says local
        cwd: "/test",
        gitBranch: "feature-test",
        tinybirdBranch: "feature_test",
        isMainBranch: false,
        branchDataOnCreate: null,
      });

      vi.mocked(buildFromInclude).mockResolvedValue({
        resources: {
          datasources: [],
          pipes: [],
          connections: [],
        },
        entities: {
          datasources: {},
          pipes: {},
          connections: {},
          rawDatasources: [],
          rawPipes: [],
          sourceFiles: [],
        },
        stats: {
          datasourceCount: 0,
          pipeCount: 0,
          connectionCount: 0,
        },
      });

      vi.mocked(getOrCreateBranch).mockResolvedValue({
        id: "branch-id",
        name: "feature_test",
        token: "branch-token",
        wasCreated: false,
        created_at: "2024-01-01",
      });

      vi.mocked(getWorkspace).mockResolvedValue({
        id: "ws-id",
        name: "test-workspace",
        user_id: "user-id",
        user_email: "user@test.com",
        scope: "USER",
        main: null,
      });

      vi.mocked(getBranchDashboardUrl).mockReturnValue("https://app.tinybird.co/dashboard");

      vi.mocked(buildToTinybird).mockResolvedValue({
        success: true,
        result: "success",
        datasourceCount: 0,
        pipeCount: 0,
        connectionCount: 0,
      });

      const result = await runBuild({
        devModeOverride: "branch", // Override to branch
      });

      expect(result.success).toBe(true);
      expect(result.branchInfo?.isLocal).toBe(false);
      // Verify branch APIs were called
      expect(getOrCreateBranch).toHaveBeenCalled();
      // Verify buildToTinybird was called with cloud URL
      expect(buildToTinybird).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "https://api.tinybird.co",
        }),
        expect.anything()
      );
    });

    it("uses config devMode when no override is provided", async () => {
      const { loadConfigAsync } = await import("../config.js");
      const { buildFromInclude } = await import("../../generator/index.js");
      const { getLocalTokens, getOrCreateLocalWorkspace, getLocalWorkspaceName } = await import("../../api/local.js");
      const { buildToTinybird } = await import("../../api/build.js");
      const { getWorkspace } = await import("../../api/workspaces.js");
      const { getLocalDashboardUrl } = await import("../../api/dashboard.js");

      // Config has devMode: "local" and no override
      vi.mocked(loadConfigAsync).mockResolvedValue({
        include: ["test.ts"],
        token: "p.test-token",
        baseUrl: "https://api.tinybird.co",
        configPath: "/test/tinybird.config.json",
        devMode: "local", // Config says local
        cwd: "/test",
        gitBranch: "feature-test",
        tinybirdBranch: "feature_test",
        isMainBranch: false,
        branchDataOnCreate: null,
      });

      vi.mocked(buildFromInclude).mockResolvedValue({
        resources: {
          datasources: [],
          pipes: [],
          connections: [],
        },
        entities: {
          datasources: {},
          pipes: {},
          connections: {},
          rawDatasources: [],
          rawPipes: [],
          sourceFiles: [],
        },
        stats: {
          datasourceCount: 0,
          pipeCount: 0,
          connectionCount: 0,
        },
      });

      vi.mocked(getLocalTokens).mockResolvedValue({
        admin_token: "admin-token",
        user_token: "user-token",
        workspace_admin_token: "workspace-admin-token",
      });

      vi.mocked(getWorkspace).mockResolvedValue({
        id: "ws-id",
        name: "test-workspace",
        user_id: "user-id",
        user_email: "user@test.com",
        scope: "USER",
        main: null,
      });

      vi.mocked(getLocalWorkspaceName).mockReturnValue("feature_test_workspace");

      vi.mocked(getOrCreateLocalWorkspace).mockResolvedValue({
        workspace: { id: "local-ws-id", name: "feature_test_workspace", token: "local-token" },
        wasCreated: false,
      });

      vi.mocked(getLocalDashboardUrl).mockReturnValue("http://localhost:7181/dashboard");

      vi.mocked(buildToTinybird).mockResolvedValue({
        success: true,
        result: "success",
        datasourceCount: 0,
        pipeCount: 0,
        connectionCount: 0,
      });

      const result = await runBuild({
        // No devModeOverride - should use config's devMode: "local"
      });

      expect(result.success).toBe(true);
      expect(result.branchInfo?.isLocal).toBe(true);
      // Verify local APIs were called (because config says local)
      expect(getLocalTokens).toHaveBeenCalled();
    });
  });

  describe("branch_data_on_create wiring", () => {
    it("uses config-only last_partition when flag is absent", async () => {
      const { loadConfigAsync } = await import("../config.js");
      const { buildFromInclude } = await import("../../generator/index.js");
      const { getOrCreateBranch } = await import("../../api/branches.js");
      const { buildToTinybird } = await import("../../api/build.js");
      const { getWorkspace } = await import("../../api/workspaces.js");
      const { getBranchDashboardUrl } = await import("../../api/dashboard.js");

      vi.mocked(loadConfigAsync).mockResolvedValue({
        include: ["test.ts"],
        token: "p.test-token",
        baseUrl: "https://api.tinybird.co",
        configPath: "/test/tinybird.config.json",
        devMode: "branch",
        cwd: "/test",
        gitBranch: "feature-test",
        tinybirdBranch: "feature_test",
        isMainBranch: false,
        branchDataOnCreate: BranchDataOnCreate.LAST_PARTITION,
      });
      vi.mocked(buildFromInclude).mockResolvedValue({
        resources: { datasources: [], pipes: [], connections: [] },
        entities: { datasources: {}, pipes: {}, connections: {}, rawDatasources: [], rawPipes: [], sourceFiles: [] },
        stats: { datasourceCount: 0, pipeCount: 0, connectionCount: 0 },
      });
      vi.mocked(getOrCreateBranch).mockResolvedValue({
        id: "branch-id",
        name: "feature_test",
        token: "branch-token",
        wasCreated: false,
        created_at: "2024-01-01",
      });
      vi.mocked(getWorkspace).mockResolvedValue({
        id: "ws-id",
        name: "test-workspace",
        user_id: "user-id",
        user_email: "user@test.com",
        scope: "USER",
        main: null,
      });
      vi.mocked(getBranchDashboardUrl).mockReturnValue("https://app.tinybird.co/dashboard");
      vi.mocked(buildToTinybird).mockResolvedValue({
        success: true,
        result: "success",
        datasourceCount: 0,
        pipeCount: 0,
        connectionCount: 0,
      });

      await runBuild();
      expect(getOrCreateBranch).toHaveBeenCalledWith(
        expect.any(Object),
        "feature_test",
        { lastPartition: true }
      );
    });

    it("keeps CLI --last-partition precedence over config", async () => {
      const { loadConfigAsync } = await import("../config.js");
      const { buildFromInclude } = await import("../../generator/index.js");
      const { getOrCreateBranch } = await import("../../api/branches.js");
      const { buildToTinybird } = await import("../../api/build.js");
      const { getWorkspace } = await import("../../api/workspaces.js");
      const { getBranchDashboardUrl } = await import("../../api/dashboard.js");

      vi.mocked(loadConfigAsync).mockResolvedValue({
        include: ["test.ts"],
        token: "p.test-token",
        baseUrl: "https://api.tinybird.co",
        configPath: "/test/tinybird.config.json",
        devMode: "branch",
        cwd: "/test",
        gitBranch: "feature-test",
        tinybirdBranch: "feature_test",
        isMainBranch: false,
        branchDataOnCreate: null,
      });
      vi.mocked(buildFromInclude).mockResolvedValue({
        resources: { datasources: [], pipes: [], connections: [] },
        entities: { datasources: {}, pipes: {}, connections: {}, rawDatasources: [], rawPipes: [], sourceFiles: [] },
        stats: { datasourceCount: 0, pipeCount: 0, connectionCount: 0 },
      });
      vi.mocked(getOrCreateBranch).mockResolvedValue({
        id: "branch-id",
        name: "feature_test",
        token: "branch-token",
        wasCreated: false,
        created_at: "2024-01-01",
      });
      vi.mocked(getWorkspace).mockResolvedValue({
        id: "ws-id",
        name: "test-workspace",
        user_id: "user-id",
        user_email: "user@test.com",
        scope: "USER",
        main: null,
      });
      vi.mocked(getBranchDashboardUrl).mockReturnValue("https://app.tinybird.co/dashboard");
      vi.mocked(buildToTinybird).mockResolvedValue({
        success: true,
        result: "success",
        datasourceCount: 0,
        pipeCount: 0,
        connectionCount: 0,
      });

      await runBuild({ lastPartition: true });
      expect(getOrCreateBranch).toHaveBeenCalledWith(
        expect.any(Object),
        "feature_test",
        { lastPartition: true }
      );
    });

    it("ignores config branch_data_on_create in local mode", async () => {
      const { loadConfigAsync } = await import("../config.js");
      const { buildFromInclude } = await import("../../generator/index.js");
      const { getOrCreateBranch } = await import("../../api/branches.js");
      const { getLocalTokens, getOrCreateLocalWorkspace, getLocalWorkspaceName } = await import("../../api/local.js");
      const { buildToTinybird } = await import("../../api/build.js");
      const { getWorkspace } = await import("../../api/workspaces.js");
      const { getLocalDashboardUrl } = await import("../../api/dashboard.js");

      vi.mocked(loadConfigAsync).mockResolvedValue({
        include: ["test.ts"],
        token: "p.test-token",
        baseUrl: "https://api.tinybird.co",
        configPath: "/test/tinybird.config.json",
        devMode: "local",
        cwd: "/test",
        gitBranch: "feature-test",
        tinybirdBranch: "feature_test",
        isMainBranch: false,
        branchDataOnCreate: BranchDataOnCreate.LAST_PARTITION,
      });
      vi.mocked(buildFromInclude).mockResolvedValue({
        resources: { datasources: [], pipes: [], connections: [] },
        entities: { datasources: {}, pipes: {}, connections: {}, rawDatasources: [], rawPipes: [], sourceFiles: [] },
        stats: { datasourceCount: 0, pipeCount: 0, connectionCount: 0 },
      });
      vi.mocked(getLocalTokens).mockResolvedValue({
        admin_token: "admin-token",
        user_token: "user-token",
        workspace_admin_token: "workspace-admin-token",
      });
      vi.mocked(getWorkspace).mockResolvedValue({
        id: "ws-id",
        name: "test-workspace",
        user_id: "user-id",
        user_email: "user@test.com",
        scope: "USER",
        main: null,
      });
      vi.mocked(getLocalWorkspaceName).mockReturnValue("feature_test_workspace");
      vi.mocked(getOrCreateLocalWorkspace).mockResolvedValue({
        workspace: { id: "local-ws-id", name: "feature_test_workspace", token: "local-token" },
        wasCreated: false,
      });
      vi.mocked(getLocalDashboardUrl).mockReturnValue("http://localhost:7181/dashboard");
      vi.mocked(buildToTinybird).mockResolvedValue({
        success: true,
        result: "success",
        datasourceCount: 0,
        pipeCount: 0,
        connectionCount: 0,
      });

      await runBuild();
      expect(getOrCreateBranch).not.toHaveBeenCalled();
    });
  });
});
