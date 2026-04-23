import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePreviewBranchName, runPreview } from "./preview.js";
import { BranchDataOnCreate } from "../config-types.js";

vi.mock("../config.js", () => ({
  loadConfigAsync: vi.fn(),
  LOCAL_BASE_URL: "http://localhost:7181",
}));

vi.mock("../../generator/index.js", () => ({
  buildFromInclude: vi.fn(),
}));

vi.mock("../../api/branches.js", () => ({
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
  getBranch: vi.fn(),
}));

vi.mock("../../api/deploy.js", () => ({
  deployToMain: vi.fn(),
}));

vi.mock("../../api/build.js", () => ({
  buildToTinybird: vi.fn(),
}));

vi.mock("../../api/local.js", () => ({
  getLocalTokens: vi.fn(),
  getOrCreateLocalWorkspace: vi.fn(),
  LocalNotRunningError: class LocalNotRunningError extends Error {},
}));

vi.mock("../git.js", () => ({
  sanitizeBranchName: (value: string) => value.replace(/[^a-zA-Z0-9]/g, "_"),
  getCurrentGitBranch: vi.fn(() => "feature/test"),
}));

describe("Preview command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generatePreviewBranchName", () => {
    it("generates name with tmp_ci prefix", () => {
      const result = generatePreviewBranchName("feature-branch");
      expect(result).toBe("tmp_ci_feature_branch");
    });

    it("sanitizes branch name with slashes", () => {
      const result = generatePreviewBranchName("feature/add-login");
      expect(result).toBe("tmp_ci_feature_add_login");
    });

    it("sanitizes branch name with dots", () => {
      const result = generatePreviewBranchName("release.1.0");
      expect(result).toBe("tmp_ci_release_1_0");
    });

    it("handles complex branch names", () => {
      const result = generatePreviewBranchName("feature/JIRA-123/add-user-auth");
      expect(result).toBe("tmp_ci_feature_JIRA_123_add_user_auth");
    });

    it("uses 'unknown' when branch is null", () => {
      const result = generatePreviewBranchName(null);
      expect(result).toBe("tmp_ci_unknown");
    });

    it("produces deterministic names for same branch", () => {
      const result1 = generatePreviewBranchName("test-branch");
      const result2 = generatePreviewBranchName("test-branch");
      expect(result1).toBe(result2);
    });
  });

  describe("branch_data_on_create wiring", () => {
    it("uses config-only last_partition when creating cloud preview branch", async () => {
      const { loadConfigAsync } = await import("../config.js");
      const { buildFromInclude } = await import("../../generator/index.js");
      const { getBranch, createBranch } = await import("../../api/branches.js");
      const { deployToMain } = await import("../../api/deploy.js");

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
      vi.mocked(getBranch).mockRejectedValue(new Error("not found"));
      vi.mocked(createBranch).mockResolvedValue({
        id: "b1",
        name: "tmp_ci_feature_test",
        token: "p.branch",
        created_at: "2024-01-01T00:00:00Z",
      });
      vi.mocked(deployToMain).mockResolvedValue({
        success: true,
        result: "success",
        datasourceCount: 0,
        pipeCount: 0,
        connectionCount: 0,
      });

      await runPreview();
      expect(createBranch).toHaveBeenCalledWith(
        expect.any(Object),
        "tmp_ci_feature_test",
        { lastPartition: true }
      );
    });

    it("ignores config branch_data_on_create in local mode", async () => {
      const { loadConfigAsync } = await import("../config.js");
      const { buildFromInclude } = await import("../../generator/index.js");
      const { createBranch } = await import("../../api/branches.js");
      const { getLocalTokens, getOrCreateLocalWorkspace } = await import("../../api/local.js");
      const { buildToTinybird } = await import("../../api/build.js");

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
      vi.mocked(getOrCreateLocalWorkspace).mockResolvedValue({
        workspace: { id: "lw1", name: "tmp_ci_feature_test", token: "local-token" },
        wasCreated: true,
      });
      vi.mocked(buildToTinybird).mockResolvedValue({
        success: true,
        result: "success",
        datasourceCount: 0,
        pipeCount: 0,
        connectionCount: 0,
      });

      await runPreview();
      expect(createBranch).not.toHaveBeenCalled();
    });
  });
});
