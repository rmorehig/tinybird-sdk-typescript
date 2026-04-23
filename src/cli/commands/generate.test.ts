import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runGenerate } from "./generate.js";

vi.mock("../config.js", () => ({
  loadConfigAsync: vi.fn(),
}));

vi.mock("../../generator/index.js", () => ({
  buildFromInclude: vi.fn(),
}));

describe("Generate command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns generated artifacts with stable relative paths", async () => {
    const { loadConfigAsync } = await import("../config.js");
    const { buildFromInclude } = await import("../../generator/index.js");

    vi.mocked(loadConfigAsync).mockResolvedValue({
      include: ["lib/tinybird.ts"],
      token: "p.test-token",
      baseUrl: "https://api.tinybird.co",
      configPath: "/tmp/tinybird.config.json",
      cwd: "/tmp",
      gitBranch: "feature-x",
      tinybirdBranch: "feature_x",
      isMainBranch: false,
      devMode: "branch",
      branchDataOnCreate: null,
    });

    vi.mocked(buildFromInclude).mockResolvedValue({
      resources: {
        datasources: [{ name: "events", content: "SCHEMA >" }],
        pipes: [{ name: "events_endpoint", content: "TYPE endpoint" }],
        connections: [{ name: "kafka_main", content: "TYPE kafka" }],
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
        datasourceCount: 1,
        pipeCount: 1,
        connectionCount: 1,
      },
    });

    const result = await runGenerate();

    expect(result.success).toBe(true);
    expect(result.artifacts).toEqual([
      {
        type: "datasource",
        name: "events",
        relativePath: "datasources/events.datasource",
        content: "SCHEMA >",
      },
      {
        type: "pipe",
        name: "events_endpoint",
        relativePath: "pipes/events_endpoint.pipe",
        content: "TYPE endpoint",
      },
      {
        type: "connection",
        name: "kafka_main",
        relativePath: "connections/kafka_main.connection",
        content: "TYPE kafka",
      },
    ]);
    expect(result.stats?.totalCount).toBe(3);
  });

  it("returns an error when loading config fails", async () => {
    const { loadConfigAsync } = await import("../config.js");
    vi.mocked(loadConfigAsync).mockRejectedValue(new Error("No tinybird config"));

    const result = await runGenerate();

    expect(result.success).toBe(false);
    expect(result.error).toContain("No tinybird config");
  });

  it("writes artifacts to outputDir when requested", async () => {
    const { loadConfigAsync } = await import("../config.js");
    const { buildFromInclude } = await import("../../generator/index.js");

    vi.mocked(loadConfigAsync).mockResolvedValue({
      include: ["lib/tinybird.ts"],
      token: "p.test-token",
      baseUrl: "https://api.tinybird.co",
      configPath: "/tmp/tinybird.config.json",
      cwd: "/tmp",
      gitBranch: "feature-x",
      tinybirdBranch: "feature_x",
      isMainBranch: false,
      devMode: "branch",
      branchDataOnCreate: null,
    });

    vi.mocked(buildFromInclude).mockResolvedValue({
      resources: {
        datasources: [{ name: "events", content: "SCHEMA >" }],
        pipes: [{ name: "events_endpoint", content: "TYPE endpoint" }],
        connections: [{ name: "kafka_main", content: "TYPE kafka" }],
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
        datasourceCount: 1,
        pipeCount: 1,
        connectionCount: 1,
      },
    });

    const outputDir = await mkdtemp(join(tmpdir(), "tb-generate-test-"));
    try {
      const result = await runGenerate({ outputDir });

      expect(result.success).toBe(true);
      expect(
        await readFile(join(outputDir, "datasources/events.datasource"), "utf-8")
      ).toBe("SCHEMA >");
      expect(
        await readFile(join(outputDir, "pipes/events_endpoint.pipe"), "utf-8")
      ).toBe("TYPE endpoint");
      expect(
        await readFile(
          join(outputDir, "connections/kafka_main.connection"),
          "utf-8"
        )
      ).toBe("TYPE kafka");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("returns an error when buildFromInclude fails", async () => {
    const { loadConfigAsync } = await import("../config.js");
    const { buildFromInclude } = await import("../../generator/index.js");

    vi.mocked(loadConfigAsync).mockResolvedValue({
      include: ["lib/tinybird.ts"],
      token: "p.test-token",
      baseUrl: "https://api.tinybird.co",
      configPath: "/tmp/tinybird.config.json",
      cwd: "/tmp",
      gitBranch: "feature-x",
      tinybirdBranch: "feature_x",
      isMainBranch: false,
      devMode: "branch",
      branchDataOnCreate: null,
    });
    vi.mocked(buildFromInclude).mockRejectedValue(
      new Error("generator failed")
    );

    const result = await runGenerate();

    expect(result.success).toBe(false);
    expect(result.error).toContain("generator failed");
  });
});
