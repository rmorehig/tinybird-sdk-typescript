import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

// Mock the timing module so tests never wait real wall-clock time. The 5s
// poll cadence and 60-poll safety valve are semantic (matched to the CLI),
// but tests only care about the sequence of calls — not the delay between
// them — so we swap sleep for a no-op and shrink the safety threshold to
// something we can drive in a single test.
const { MOCK_MAX_CONSECUTIVE_FAILED_POLLS } = vi.hoisted(() => ({
  MOCK_MAX_CONSECUTIVE_FAILED_POLLS: 3,
}));
vi.mock("./_deploy_timing.js", () => ({
  POLL_INTERVAL_MS: 0,
  MAX_CONSECUTIVE_FAILED_POLLS: MOCK_MAX_CONSECUTIVE_FAILED_POLLS,
  sleep: () => Promise.resolve(),
}));

import { deployToMain } from "./deploy.js";
import type { BuildConfig } from "./build.js";
import {
  BASE_URL,
  createDeploySuccessResponse,
  createDeploymentStatusResponse,
  createBuildFailureResponse,
  createBuildMultipleErrorsResponse,
  createDeploymentsListResponse,
} from "../test/handlers.js";
import type { GeneratedResources } from "../generator/index.js";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  // Set up default handler for deployments list (used by stale deployment cleanup)
  server.use(
    http.get(`${BASE_URL}/v1/deployments`, () => {
      return HttpResponse.json(createDeploymentsListResponse());
    })
  );
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("Deploy API", () => {
  const config: BuildConfig = {
    baseUrl: BASE_URL,
    token: "p.test-token",
  };

  const resources: GeneratedResources = {
    datasources: [
      { name: "events", content: "SCHEMA > timestamp DateTime" },
    ],
    pipes: [
      { name: "top_events", content: "NODE main\nSQL > SELECT * FROM events" },
    ],
    connections: [],
  };

  // Helper to set up successful deploy flow. By default the deployment shows
  // up as live on the very first status poll, which matches the server-side
  // auto_promote=true behavior the SDK now relies on.
  function setupSuccessfulDeployFlow(deploymentId = "deploy-abc") {
    server.use(
      http.post(`${BASE_URL}/v1/deploy`, () => {
        return HttpResponse.json(
          createDeploySuccessResponse({ deploymentId, status: "pending" })
        );
      }),
      http.get(`${BASE_URL}/v1/deployments/${deploymentId}`, () => {
        return HttpResponse.json(
          createDeploymentStatusResponse({
            deploymentId,
            status: "data_ready",
            live: true,
          })
        );
      })
    );
  }

  describe("deployToMain", () => {
    it("successfully deploys resources with full flow", async () => {
      setupSuccessfulDeployFlow("deploy-abc");

      const result = await deployToMain(config, resources);

      expect(result.success).toBe(true);
      expect(result.result).toBe("success");
      expect(result.buildId).toBe("deploy-abc");
      expect(result.datasourceCount).toBe(1);
      expect(result.pipeCount).toBe(1);
    });

    it("polls until deployment is ready and live", async () => {
      let pollCount = 0;

      server.use(
        http.post(`${BASE_URL}/v1/deploy`, () => {
          return HttpResponse.json(
            createDeploySuccessResponse({ deploymentId: "deploy-poll", status: "pending" })
          );
        }),
        http.get(`${BASE_URL}/v1/deployments/deploy-poll`, () => {
          pollCount++;
          // pending → data_ready (not live yet) → data_ready + live.
          if (pollCount < 3) {
            return HttpResponse.json(
              createDeploymentStatusResponse({
                deploymentId: "deploy-poll",
                status: "pending",
                live: false,
              })
            );
          }
          if (pollCount === 3) {
            return HttpResponse.json(
              createDeploymentStatusResponse({
                deploymentId: "deploy-poll",
                status: "data_ready",
                live: false,
              })
            );
          }
          return HttpResponse.json(
            createDeploymentStatusResponse({
              deploymentId: "deploy-poll",
              status: "data_ready",
              live: true,
            })
          );
        })
      );

      const result = await deployToMain(config, resources);

      expect(result.success).toBe(true);
      expect(pollCount).toBe(4);
    });

    it("handles deploy failure with single error", async () => {
      server.use(
        http.post(`${BASE_URL}/v1/deploy`, () => {
          return HttpResponse.json(
            createBuildFailureResponse("Permission denied"),
            { status: 200 }
          );
        })
      );

      const result = await deployToMain(config, resources);

      expect(result.success).toBe(false);
      expect(result.result).toBe("failed");
      expect(result.error).toBe("Permission denied");
    });

    it("handles deploy failure with multiple errors", async () => {
      server.use(
        http.post(`${BASE_URL}/v1/deploy`, () => {
          return HttpResponse.json(
            createBuildMultipleErrorsResponse([
              { filename: "events.datasource", error: "Schema mismatch" },
              { error: "General error without filename" },
            ]),
            { status: 200 }
          );
        })
      );

      const result = await deployToMain(config, resources);

      expect(result.success).toBe(false);
      expect(result.error).toContain("[events.datasource] Schema mismatch");
      expect(result.error).toContain("General error without filename");
    });

    it("handles deployment feedback entries with null resource", async () => {
      server.use(
        http.post(`${BASE_URL}/v1/deploy`, () => {
          return HttpResponse.json(
            {
              result: "failed",
              deployment: {
                id: "deploy-null-resource",
                status: "failed",
                feedback: [{ resource: null, level: "ERROR", message: "Invalid token" }],
              },
            },
            { status: 200 }
          );
        })
      );

      const result = await deployToMain(config, resources);

      expect(result.success).toBe(false);
      expect(result.result).toBe("failed");
      expect(result.error).toContain("unknown: Invalid token");
    });

    it("handles HTTP error responses", async () => {
      server.use(
        http.post(`${BASE_URL}/v1/deploy`, () => {
          return HttpResponse.json(
            { result: "failed", error: "Forbidden" },
            { status: 403 }
          );
        })
      );

      const result = await deployToMain(config, resources);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Forbidden");
    });

    it("handles malformed JSON response", async () => {
      server.use(
        http.post(`${BASE_URL}/v1/deploy`, () => {
          return new HttpResponse("invalid json {", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        })
      );

      await expect(deployToMain(config, resources)).rejects.toThrow(
        "Failed to parse response"
      );
    });

    it("uses /v1/deploy endpoint with auto_promote by default", async () => {
      let capturedUrl: string | null = null;

      server.use(
        http.post(`${BASE_URL}/v1/deploy`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(
            createDeploySuccessResponse({ deploymentId: "deploy-url-test" })
          );
        }),
        http.get(`${BASE_URL}/v1/deployments/deploy-url-test`, () => {
          return HttpResponse.json(
            createDeploymentStatusResponse({
              deploymentId: "deploy-url-test",
              status: "data_ready",
              live: true,
            })
          );
        })
      );

      await deployToMain(config, resources);

      const parsed = new URL(capturedUrl ?? "");
      expect(parsed.pathname).toBe("/v1/deploy");
      expect(parsed.searchParams.get("from")).toBe("ts-sdk");
      expect(parsed.searchParams.get("auto_promote")).toBe("true");
    });

    it("omits auto_promote when auto is false", async () => {
      let capturedUrl: string | null = null;

      server.use(
        http.post(`${BASE_URL}/v1/deploy`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(
            createDeploySuccessResponse({ deploymentId: "deploy-no-auto" })
          );
        }),
        http.get(`${BASE_URL}/v1/deployments/deploy-no-auto`, () => {
          return HttpResponse.json(
            createDeploymentStatusResponse({
              deploymentId: "deploy-no-auto",
              status: "data_ready",
              live: false,
            })
          );
        })
      );

      const result = await deployToMain(config, resources, { auto: false });

      const parsed = new URL(capturedUrl ?? "");
      expect(parsed.searchParams.get("auto_promote")).toBeNull();
      // When !auto, we return success as soon as the deployment is data_ready,
      // even though `live` is still false (user must promote it separately).
      expect(result.success).toBe(true);
      expect(result.buildId).toBe("deploy-no-auto");
    });

    it("returns immediately when wait is false", async () => {
      let statusPolls = 0;

      server.use(
        http.post(`${BASE_URL}/v1/deploy`, () => {
          return HttpResponse.json(
            createDeploySuccessResponse({ deploymentId: "deploy-no-wait" })
          );
        }),
        http.get(`${BASE_URL}/v1/deployments/deploy-no-wait`, () => {
          statusPolls++;
          return HttpResponse.json(
            createDeploymentStatusResponse({
              deploymentId: "deploy-no-wait",
              status: "pending",
              live: false,
            })
          );
        })
      );

      const result = await deployToMain(config, resources, { wait: false });

      expect(result.success).toBe(true);
      expect(result.buildId).toBe("deploy-no-wait");
      // No polling should have happened.
      expect(statusPolls).toBe(0);
    });

    it("passes allow_destructive_operations when explicitly enabled", async () => {
      let capturedUrl: string | null = null;

      server.use(
        http.post(`${BASE_URL}/v1/deploy`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(
            createDeploySuccessResponse({ deploymentId: "deploy-destructive" })
          );
        }),
        http.get(`${BASE_URL}/v1/deployments/deploy-destructive`, () => {
          return HttpResponse.json(
            createDeploymentStatusResponse({
              deploymentId: "deploy-destructive",
              status: "data_ready",
              live: true,
            })
          );
        })
      );

      await deployToMain(config, resources, {
        allowDestructiveOperations: true,
      });

      const parsed = new URL(capturedUrl ?? "");
      expect(parsed.searchParams.get("allow_destructive_operations")).toBe("true");
    });

    it("skips stale deployment cleanup in check mode", async () => {
      let listed = false;
      const deletedIds: string[] = [];
      let capturedUrl: string | null = null;

      server.use(
        http.get(`${BASE_URL}/v1/deployments`, () => {
          listed = true;
          return HttpResponse.json(
            createDeploymentsListResponse({
              deployments: [
                { id: "in-flight", status: "pending", live: false },
              ],
            })
          );
        }),
        http.delete(`${BASE_URL}/v1/deployments/:id`, ({ params }) => {
          deletedIds.push(params.id as string);
          return HttpResponse.json({ result: "success" });
        }),
        http.post(`${BASE_URL}/v1/deploy`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(
            createDeploySuccessResponse({ deploymentId: "deploy-check" })
          );
        })
      );

      await deployToMain(config, resources, { check: true });

      expect(listed).toBe(false);
      expect(deletedIds).toEqual([]);
      const parsed = new URL(capturedUrl ?? "");
      expect(parsed.searchParams.get("check")).toBe("true");
    });

    it("deletes stale non-live deployments before deploy and previous live deployment after promotion", async () => {
      const deletedIds: string[] = [];

      server.use(
        http.get(`${BASE_URL}/v1/deployments`, () => {
          return HttpResponse.json(
            createDeploymentsListResponse({
              deployments: [
                { id: "stale-1", status: "pending", live: false },
                { id: "live-1", status: "live", live: true },
                { id: "stale-2", status: "failed", live: false },
              ],
            })
          );
        }),
        http.delete(`${BASE_URL}/v1/deployments/:id`, ({ params }) => {
          deletedIds.push(params.id as string);
          return HttpResponse.json({ result: "success" });
        })
      );
      setupSuccessfulDeployFlow("deploy-cleanup");

      await deployToMain(config, resources);

      // The previous live deployment is left alone — the server removes it
      // as part of the auto-promotion once the new deployment is live.
      expect(deletedIds).toEqual(["stale-1", "stale-2"]);
    });

    it("does not touch the previous live deployment client-side", async () => {
      // With auto_promote=true the server flips the new deployment live AND
      // deletes the previous live deployment on our behalf. The SDK should
      // therefore never issue a set-live or a delete for a live deployment.
      const events: string[] = [];

      server.use(
        http.get(`${BASE_URL}/v1/deployments`, () => {
          return HttpResponse.json(
            createDeploymentsListResponse({
              deployments: [
                { id: "previous-live", status: "live", live: true },
              ],
            })
          );
        }),
        http.post(`${BASE_URL}/v1/deploy`, () => {
          events.push("create");
          return HttpResponse.json(
            createDeploySuccessResponse({ deploymentId: "new-deploy", status: "pending" })
          );
        }),
        http.get(`${BASE_URL}/v1/deployments/new-deploy`, () => {
          return HttpResponse.json(
            createDeploymentStatusResponse({
              deploymentId: "new-deploy",
              status: "data_ready",
              live: true,
            })
          );
        }),
        http.delete(`${BASE_URL}/v1/deployments/:id`, ({ params }) => {
          events.push(`delete:${params.id as string}`);
          return HttpResponse.json({ result: "success" });
        })
      );

      const result = await deployToMain(config, resources);

      expect(result.success).toBe(true);
      expect(events).toEqual(["create"]);
    });

    it("adds actionable guidance to Forward/Classic workspace errors", async () => {
      server.use(
        http.post(`${BASE_URL}/v1/deploy`, () => {
          return HttpResponse.json(
            {
              result: "failed",
              error:
                "This is a Tinybird Forward workspace, and this operation is only available for Tinybird Classic workspaces.",
            },
            { status: 400 }
          );
        })
      );

      const result = await deployToMain(config, resources);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tinybird Forward workspace");
      expect(result.error).toContain(
        "Use the Tinybird Classic CLI (`tb`) from a Tinybird Classic workspace for this operation."
      );
    });

    it("tolerates transient failed status while server auto-deletes", async () => {
      // When the deployment hits `failed`, the SDK should not bail immediately
      // — the server usually transitions it to `deleting`/`deleted` shortly
      // after. We report the failure only when that transition happens.
      let pollCount = 0;
      server.use(
        http.post(`${BASE_URL}/v1/deploy`, () => {
          return HttpResponse.json(
            createDeploySuccessResponse({ deploymentId: "deploy-transient-fail" })
          );
        }),
        http.get(`${BASE_URL}/v1/deployments/deploy-transient-fail`, () => {
          pollCount++;
          if (pollCount <= 2) {
            return HttpResponse.json(
              createDeploymentStatusResponse({
                deploymentId: "deploy-transient-fail",
                status: "failed",
                live: false,
              })
            );
          }
          return HttpResponse.json({
            result: "success",
            deployment: {
              id: "deploy-transient-fail",
              status: "deleted",
              live: false,
              feedback: [
                { resource: null, level: "ERROR", message: "schema conflict" },
              ],
            },
          });
        })
      );

      const result = await deployToMain(config, resources);

      expect(result.success).toBe(false);
      expect(result.error).toContain("deleted automatically");
      expect(result.error).toContain("schema conflict");
      // 2 failed + 1 deleted.
      expect(pollCount).toBe(3);
    });

    it("bails when the deployment is stuck in failed state", async () => {
      let pollCount = 0;
      server.use(
        http.post(`${BASE_URL}/v1/deploy`, () => {
          return HttpResponse.json(
            createDeploySuccessResponse({ deploymentId: "deploy-stuck" })
          );
        }),
        http.get(`${BASE_URL}/v1/deployments/deploy-stuck`, () => {
          pollCount++;
          return HttpResponse.json(
            createDeploymentStatusResponse({
              deploymentId: "deploy-stuck",
              status: "failed",
              live: false,
            })
          );
        })
      );

      const result = await deployToMain(config, resources);

      expect(result.success).toBe(false);
      expect(result.error).toContain("didn't start deleting automatically");
      // One extra poll past the threshold trips the safety valve.
      expect(pollCount).toBe(MOCK_MAX_CONSECUTIVE_FAILED_POLLS + 1);
    });

    it("normalizes baseUrl with trailing slash", async () => {
      let capturedUrl: string | null = null;

      server.use(
        http.post(`${BASE_URL}/v1/deploy`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(
            createDeploySuccessResponse({ deploymentId: "deploy-slash" })
          );
        }),
        http.get(`${BASE_URL}/v1/deployments/deploy-slash`, () => {
          return HttpResponse.json(
            createDeploymentStatusResponse({
              deploymentId: "deploy-slash",
              status: "data_ready",
              live: true,
            })
          );
        })
      );

      await deployToMain({ ...config, baseUrl: `${BASE_URL}/` }, resources);

      const parsed = new URL(capturedUrl ?? "");
      expect(parsed.pathname).toBe("/v1/deploy");
      expect(parsed.searchParams.get("from")).toBe("ts-sdk");
    });

    it("includes connections in deploy form data", async () => {
      const resourcesWithConnections: GeneratedResources = {
        ...resources,
        connections: [
          {
            name: "my_kafka",
            content: "TYPE kafka\nKAFKA_BROKERS kafka:9092\nKAFKA_TOPIC events\n",
          },
        ],
      };

      let capturedFormData: FormData | null = null;

      server.use(
        http.post(`${BASE_URL}/v1/deploy`, async ({ request }) => {
          capturedFormData = await request.formData();
          return HttpResponse.json(
            createDeploySuccessResponse({ deploymentId: "deploy-conn", status: "pending" })
          );
        }),
        http.get(`${BASE_URL}/v1/deployments/deploy-conn`, () => {
          return HttpResponse.json(
            createDeploymentStatusResponse({
              deploymentId: "deploy-conn",
              status: "data_ready",
              live: true,
            })
          );
        })
      );

      const result = await deployToMain(config, resourcesWithConnections);

      expect(result.success).toBe(true);
      expect(result.connectionCount).toBe(1);
      expect(capturedFormData).not.toBeNull();
      // 1 datasource + 1 pipe + 1 connection
      const allValues = capturedFormData!.getAll("data_project://");
      expect(allValues.length).toBe(3);
    });
  });
});
