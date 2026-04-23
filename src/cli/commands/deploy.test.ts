import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runDeploy } from "./deploy.js";

vi.mock("../config.js", () => ({
  loadConfigAsync: vi.fn(),
}));

vi.mock("../../generator/index.js", () => ({
  buildFromInclude: vi.fn(),
}));

vi.mock("../../api/deploy.js", () => ({
  deployToMain: vi.fn(),
}));

describe("Deploy command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("passes allowDestructiveOperations to deployToMain", async () => {
    const { loadConfigAsync } = await import("../config.js");
    const { buildFromInclude } = await import("../../generator/index.js");
    const { deployToMain } = await import("../../api/deploy.js");

    vi.mocked(loadConfigAsync).mockResolvedValue({
      include: ["tinybird/*.ts"],
      token: "p.test-token",
      baseUrl: "https://api.tinybird.co",
      configPath: "/test/tinybird.config.json",
      cwd: "/test",
      gitBranch: "feature-pro-610",
      tinybirdBranch: "feature_pro_610",
      isMainBranch: false,
      devMode: "branch",
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

    vi.mocked(deployToMain).mockResolvedValue({
      success: true,
      result: "success",
      datasourceCount: 0,
      pipeCount: 0,
      connectionCount: 0,
    });

    const result = await runDeploy({ allowDestructiveOperations: true });

    expect(result.success).toBe(true);
    expect(deployToMain).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        allowDestructiveOperations: true,
      })
    );
  });
});
