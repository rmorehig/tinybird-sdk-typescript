import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createTinybirdApi } from "./api.js";
import { TINYBIRD_FROM_PARAM } from "./fetcher.js";
import { BASE_URL } from "../test/handlers.js";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("TinybirdApi", () => {
  it("sends authorization header and from=ts-sdk param", async () => {
    let authorizationHeader: string | null = null;
    let fromParam: string | null = null;

    server.use(
      http.get(`${BASE_URL}/v1/workspace`, ({ request }) => {
        authorizationHeader = request.headers.get("Authorization");
        const url = new URL(request.url);
        fromParam = url.searchParams.get("from");
        return HttpResponse.json({ ok: true });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    await api.request("/v1/workspace");

    expect(authorizationHeader).toBe("Bearer p.default-token");
    expect(fromParam).toBe(TINYBIRD_FROM_PARAM);
  });

  it("resolves relative paths and preserves query params", async () => {
    let fooParam: string | null = null;
    let fromParam: string | null = null;

    server.use(
      http.get(`${BASE_URL}/v1/build`, ({ request }) => {
        const url = new URL(request.url);
        fooParam = url.searchParams.get("foo");
        fromParam = url.searchParams.get("from");
        return HttpResponse.json({ ok: true });
      })
    );

    const api = createTinybirdApi({
      baseUrl: `${BASE_URL}/`,
      token: "p.default-token",
    });

    await api.request("v1/build?foo=bar");

    expect(fooParam).toBe("bar");
    expect(fromParam).toBe(TINYBIRD_FROM_PARAM);
  });

  it("allows per-request token override", async () => {
    let authorizationHeader: string | null = null;

    server.use(
      http.get(`${BASE_URL}/v1/workspace`, ({ request }) => {
        authorizationHeader = request.headers.get("Authorization");
        return HttpResponse.json({ ok: true });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    await api.request("/v1/workspace", { token: "p.override-token" });

    expect(authorizationHeader).toBe("Bearer p.override-token");
  });

  it("queries endpoint params via tinybirdApi.query", async () => {
    let fromParam: string | null = null;
    let startDateParam: string | null = null;
    let limitParam: string | null = null;
    let tagsParams: string[] = [];

    server.use(
      http.get(`${BASE_URL}/v0/pipes/top_pages.json`, ({ request }) => {
        const url = new URL(request.url);
        fromParam = url.searchParams.get("from");
        startDateParam = url.searchParams.get("start_date");
        limitParam = url.searchParams.get("limit");
        tagsParams = url.searchParams.getAll("tags");

        return HttpResponse.json({
          data: [{ pathname: "/", views: 1 }],
          meta: [
            { name: "pathname", type: "String" },
            { name: "views", type: "UInt64" },
          ],
          rows: 1,
          statistics: {
            elapsed: 0.001,
            rows_read: 1,
            bytes_read: 10,
          },
        });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    const result = await api.query<{ pathname: string; views: number }>("top_pages", {
      start_date: "2024-01-01 00:00:00",
      limit: 5,
      tags: ["a", "b"],
    });

    expect(result.rows).toBe(1);
    expect(result.data[0]).toEqual({ pathname: "/", views: 1 });
    expect(fromParam).toBe(TINYBIRD_FROM_PARAM);
    expect(startDateParam).toBe("2024-01-01 00:00:00");
    expect(limitParam).toBe("5");
    expect(tagsParams).toEqual(["a", "b"]);
  });

  it("throws when query params include Date values", async () => {
    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    await expect(
      api.query("top_pages", {
        start_date: new Date("2024-01-01T00:00:00.000Z"),
      })
    ).rejects.toThrow("Date values are not supported for query parameter");
  });

  it("JSON-stringifies plain object query params (p.json())", async () => {
    let configOverridesParam: string | null = null;
    let preStringifiedParam: string | null = null;
    let objectArrayParams: string[] = [];
    let limitParam: string | null = null;
    let tagsParams: string[] = [];

    server.use(
      http.get(`${BASE_URL}/v0/pipes/json_echo.json`, ({ request }) => {
        const url = new URL(request.url);
        configOverridesParam = url.searchParams.get("configOverrides");
        preStringifiedParam = url.searchParams.get("preStringified");
        objectArrayParams = url.searchParams.getAll("items");
        limitParam = url.searchParams.get("limit");
        tagsParams = url.searchParams.getAll("tags");

        return HttpResponse.json({
          data: [{ key_count: 1 }],
          meta: [{ name: "key_count", type: "UInt64" }],
          rows: 1,
          statistics: {
            elapsed: 0.001,
            rows_read: 1,
            bytes_read: 10,
          },
        });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    await api.query("json_echo", {
      configOverrides: { foo: 1 },
      preStringified: '{"foo":1}',
      items: [{ a: 1 }, { b: 2 }],
      limit: 5,
      tags: ["a", "b"],
    });

    expect(configOverridesParam).toBe('{"foo":1}');
    expect(configOverridesParam).not.toBe("[object Object]");
    expect(preStringifiedParam).toBe('{"foo":1}');
    expect(objectArrayParams).toEqual(['{"a":1}', '{"b":2}']);
    expect(limitParam).toBe("5");
    expect(tagsParams).toEqual(["a", "b"]);
  });

  it("throws when array query params include Date values", async () => {
    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    await expect(
      api.query("top_pages", {
        tags: [new Date("2024-01-01T00:00:00.000Z")],
      })
    ).rejects.toThrow("Date values are not supported for query parameter");
  });

  it("ingests rows via tinybirdApi.ingest", async () => {
    let datasourceName: string | null = null;
    let waitParam: string | null = null;
    let fromParam: string | null = null;
    let contentType: string | null = null;
    let parsedBody: Record<string, unknown> | null = null;

    server.use(
      http.post(`${BASE_URL}/v0/events`, async ({ request }) => {
        const url = new URL(request.url);
        datasourceName = url.searchParams.get("name");
        waitParam = url.searchParams.get("wait");
        fromParam = url.searchParams.get("from");
        contentType = request.headers.get("content-type");

        const rawBody = await request.text();
        parsedBody = JSON.parse(rawBody);

        return HttpResponse.json({
          successful_rows: 1,
          quarantined_rows: 0,
        });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    const result = await api.ingest("events", {
      timestamp: "2024-01-01 00:00:00",
      count: 10n,
      payload: new Map([["k", "v"]]),
      nested: {
        when: "2024-01-02 00:00:00",
      },
    });

    expect(result).toEqual({ successful_rows: 1, quarantined_rows: 0 });
    expect(datasourceName).toBe("events");
    expect(waitParam).toBe("true");
    expect(fromParam).toBe(TINYBIRD_FROM_PARAM);
    expect(contentType).toBe("application/x-ndjson");
    expect(parsedBody).toEqual({
      timestamp: "2024-01-01 00:00:00",
      count: "10",
      payload: { k: "v" },
      nested: { when: "2024-01-02 00:00:00" },
    });
  });

  it("throws when ingest payload includes Date values", async () => {
    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    await expect(
      api.ingest("events", {
        timestamp: new Date("2024-01-01T00:00:00.000Z"),
      })
    ).rejects.toThrow("Date values are not supported in ingest payloads");
  });

  it("does not retry ingest on 503 when retry is disabled", async () => {
    let attempts = 0;

    server.use(
      http.post(`${BASE_URL}/v0/events`, () => {
        attempts += 1;
        return new HttpResponse("Service unavailable", { status: 503 });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    await expect(
      api.ingest("events", { timestamp: "2024-01-01 00:00:00" })
    ).rejects.toMatchObject({
      name: "TinybirdApiError",
      statusCode: 503,
    });
    expect(attempts).toBe(1);
  });

  it("retries ingest on 503 with exponential backoff", async () => {
    let attempts = 0;

    server.use(
      http.post(`${BASE_URL}/v0/events`, () => {
        attempts += 1;
        if (attempts === 1) {
          return new HttpResponse("Service unavailable", { status: 503 });
        }

        return HttpResponse.json({
          successful_rows: 1,
          quarantined_rows: 0,
        });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    const result = await api.ingest(
      "events",
      { timestamp: "2024-01-01 00:00:00" },
      {
        maxRetries: 1,
      }
    );

    expect(result).toEqual({ successful_rows: 1, quarantined_rows: 0 });
    expect(attempts).toBe(2);
  });

  it("retries ingest on 429 with retry-after header and succeeds", async () => {
    let attempts = 0;

    server.use(
      http.post(`${BASE_URL}/v0/events`, () => {
        attempts += 1;
        if (attempts === 1) {
          return new HttpResponse("Rate limited", {
            status: 429,
            headers: {
              "Retry-After": "0",
            },
          });
        }

        return HttpResponse.json({
          successful_rows: 1,
          quarantined_rows: 0,
        });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    const result = await api.ingest(
      "events",
      { timestamp: "2024-01-01 00:00:00" },
      {
        maxRetries: 1,
      }
    );

    expect(result).toEqual({ successful_rows: 1, quarantined_rows: 0 });
    expect(attempts).toBe(2);
  });

  it("drains retryable 429 response body before retrying", async () => {
    let attempts = 0;
    let firstResponse: Response | undefined;

    const customFetch: typeof fetch = async () => {
      attempts += 1;
      if (attempts === 1) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("rate limited"));
            controller.close();
          },
        });

        firstResponse = new Response(stream, {
          status: 429,
          headers: {
            "Retry-After": "0",
          },
        });
        return firstResponse;
      }

      return new Response(
        JSON.stringify({
          successful_rows: 1,
          quarantined_rows: 0,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    };

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
      fetch: customFetch,
    });

    const result = await api.ingest(
      "events",
      { timestamp: "2024-01-01 00:00:00" },
      {
        maxRetries: 1,
      }
    );

    expect(result).toEqual({ successful_rows: 1, quarantined_rows: 0 });
    expect(attempts).toBe(2);
    expect(firstResponse?.bodyUsed).toBe(true);
  });

  it("does not retry 429 when rate-limit delay headers are missing", async () => {
    let attempts = 0;

    server.use(
      http.post(`${BASE_URL}/v0/events`, () => {
        attempts += 1;
        return new HttpResponse("Rate limited", { status: 429 });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    await expect(
      api.ingest(
        "events",
        { timestamp: "2024-01-01 00:00:00" },
        {
          maxRetries: 3,
        }
      )
    ).rejects.toMatchObject({
      name: "TinybirdApiError",
      statusCode: 429,
    });
    expect(attempts).toBe(1);
  });

  it("does not retry ingest on non-retryable status by default", async () => {
    let attempts = 0;

    server.use(
      http.post(`${BASE_URL}/v0/events`, () => {
        attempts += 1;
        return HttpResponse.json({ error: "Invalid payload" }, { status: 400 });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    await expect(
      api.ingest(
        "events",
        { timestamp: "2024-01-01 00:00:00" },
        {
          maxRetries: 3,
        }
      )
    ).rejects.toMatchObject({
      name: "TinybirdApiError",
      statusCode: 400,
    });

    expect(attempts).toBe(1);
  });

  it("stops retrying ingest after maxRetries on 429", async () => {
    let attempts = 0;

    server.use(
      http.post(`${BASE_URL}/v0/events`, () => {
        attempts += 1;
        return new HttpResponse("Rate limited", {
          status: 429,
          headers: {
            "Retry-After": "0",
          },
        });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    await expect(
      api.ingest(
        "events",
        { timestamp: "2024-01-01 00:00:00" },
        {
          maxRetries: 2,
        }
      )
    ).rejects.toMatchObject({
      name: "TinybirdApiError",
      statusCode: 429,
    });

    expect(attempts).toBe(3);
  });

  it("stops retrying ingest after maxRetries on 503", async () => {
    let attempts = 0;

    server.use(
      http.post(`${BASE_URL}/v0/events`, () => {
        attempts += 1;
        return new HttpResponse("Service unavailable", { status: 503 });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    await expect(
      api.ingest(
        "events",
        { timestamp: "2024-01-01 00:00:00" },
        {
          maxRetries: 2,
        }
      )
    ).rejects.toMatchObject({
      name: "TinybirdApiError",
      statusCode: 503,
    });

    expect(attempts).toBe(3);
  });

  it("retries ingest on 503 when wait is false", async () => {
    let attempts = 0;

    server.use(
      http.post(`${BASE_URL}/v0/events`, () => {
        attempts += 1;
        if (attempts === 1) {
          return new HttpResponse("Service unavailable", { status: 503 });
        }

        return HttpResponse.json({
          successful_rows: 1,
          quarantined_rows: 0,
        });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    const result = await api.ingest(
      "events",
      { timestamp: "2024-01-01 00:00:00" },
      {
        wait: false,
        maxRetries: 1,
      }
    );

    expect(result).toEqual({
      successful_rows: 1,
      quarantined_rows: 0,
    });
    expect(attempts).toBe(2);
  });

  it("does not retry 500 even when wait is false", async () => {
    let attempts = 0;

    server.use(
      http.post(`${BASE_URL}/v0/events`, () => {
        attempts += 1;
        return new HttpResponse("Internal error", { status: 500 });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    await expect(
      api.ingest(
        "events",
        { timestamp: "2024-01-01 00:00:00" },
        {
          wait: false,
          maxRetries: 3,
        }
      )
    ).rejects.toMatchObject({
      name: "TinybirdApiError",
      statusCode: 500,
    });

    expect(attempts).toBe(1);
  });

  it("does not retry ingest on transient network errors", async () => {
    let fetchAttempts = 0;

    server.use(
      http.post(`${BASE_URL}/v0/events`, () => {
        return HttpResponse.json({
          successful_rows: 1,
          quarantined_rows: 0,
        });
      })
    );

    const flakyFetch: typeof fetch = async (input, init) => {
      fetchAttempts += 1;
      if (fetchAttempts === 1) {
        throw new TypeError("fetch failed");
      }
      return fetch(input, init);
    };

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
      fetch: flakyFetch,
    });

    await expect(
      api.ingest(
        "events",
        { timestamp: "2024-01-01 00:00:00" },
        {
          maxRetries: 1,
        }
      )
    ).rejects.toThrow("fetch failed");
    expect(fetchAttempts).toBe(1);
  });

  it("executes raw SQL via tinybirdApi.sql", async () => {
    let rawSql: string | null = null;
    let contentType: string | null = null;

    server.use(
      http.post(`${BASE_URL}/v0/sql`, async ({ request }) => {
        contentType = request.headers.get("content-type");
        rawSql = await request.text();

        return HttpResponse.json({
          data: [{ value: 1 }],
          meta: [{ name: "value", type: "UInt8" }],
          rows: 1,
          statistics: {
            elapsed: 0.001,
            rows_read: 1,
            bytes_read: 1,
          },
        });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    const result = await api.sql<{ value: number }>("SELECT 1 AS value");

    expect(result.data[0]?.value).toBe(1);
    expect(contentType).toBe("text/plain");
    expect(rawSql).toBe("SELECT 1 AS value");
  });

  it("creates tokens via tinybirdApi.createToken", async () => {
    let expirationTime: string | null = null;
    let fromParam: string | null = null;
    let contentType: string | null = null;
    let parsedBody: Record<string, unknown> | null = null;

    server.use(
      http.post(`${BASE_URL}/v0/tokens/`, async ({ request }) => {
        const url = new URL(request.url);
        expirationTime = url.searchParams.get("expiration_time");
        fromParam = url.searchParams.get("from");
        contentType = request.headers.get("content-type");
        parsedBody = (await request.json()) as Record<string, unknown>;

        return HttpResponse.json({
          token: "eyJ.test",
        });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    const result = await api.createToken(
      {
        name: "user_token",
        scopes: [{ type: "PIPES:READ", resource: "pipe_a" }],
      },
      { expirationTime: 1700000000 }
    );

    expect(result).toEqual({ token: "eyJ.test" });
    expect(expirationTime).toBe("1700000000");
    expect(fromParam).toBe(TINYBIRD_FROM_PARAM);
    expect(contentType).toBe("application/json");
    expect(parsedBody).toEqual({
      name: "user_token",
      scopes: [{ type: "PIPES:READ", resource: "pipe_a" }],
    });
  });

  it("returns zero counts for empty ingest batches", async () => {
    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    const result = await api.ingestBatch("events", []);

    expect(result).toEqual({ successful_rows: 0, quarantined_rows: 0 });
  });

  it("parses JSON responses", async () => {
    server.use(
      http.get(`${BASE_URL}/v1/workspace`, () => {
        return HttpResponse.json({ id: "ws_123", name: "main" });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    const result = await api.requestJson<{ id: string; name: string }>("/v1/workspace");

    expect(result.id).toBe("ws_123");
    expect(result.name).toBe("main");
  });

  it("throws TinybirdApiError for non-OK responses", async () => {
    server.use(
      http.get(`${BASE_URL}/v1/workspace`, () => {
        return new HttpResponse("Unauthorized", { status: 401 });
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    await expect(api.requestJson("/v1/workspace")).rejects.toMatchObject({
      name: "TinybirdApiError",
      statusCode: 401,
      responseBody: "Unauthorized",
    });
  });

  it("throws TinybirdApiError with parsed API details", async () => {
    server.use(
      http.get(`${BASE_URL}/v0/pipes/broken.json`, () => {
        return HttpResponse.json(
          {
            error: "Invalid query",
            status: 400,
            documentation: "https://www.tinybird.co/docs",
          },
          { status: 400 }
        );
      })
    );

    const api = createTinybirdApi({
      baseUrl: BASE_URL,
      token: "p.default-token",
    });

    await expect(api.query("broken")).rejects.toMatchObject({
      name: "TinybirdApiError",
      statusCode: 400,
      message: "Invalid query",
      response: {
        error: "Invalid query",
        status: 400,
      },
    });
  });

  describe("appendDatasource", () => {
    it("appends data from URL", async () => {
      let datasourceName: string | null = null;
      let modeParam: string | null = null;
      let formatParam: string | null = null;
      let contentType: string | null = null;
      let requestBody: string | null = null;

      server.use(
        http.post(`${BASE_URL}/v0/datasources`, async ({ request }) => {
          const url = new URL(request.url);
          datasourceName = url.searchParams.get("name");
          modeParam = url.searchParams.get("mode");
          formatParam = url.searchParams.get("format");
          contentType = request.headers.get("content-type");
          requestBody = await request.text();

          return HttpResponse.json({
            successful_rows: 100,
            quarantined_rows: 0,
            import_id: "import_123",
          });
        })
      );

      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      const result = await api.appendDatasource("events", {
        url: "https://example.com/data.csv",
      });

      expect(result).toEqual({
        successful_rows: 100,
        quarantined_rows: 0,
        import_id: "import_123",
      });
      expect(datasourceName).toBe("events");
      expect(modeParam).toBe("append");
      expect(formatParam).toBe("csv");
      expect(contentType).toBe("application/x-www-form-urlencoded");
      expect(requestBody).toBe("url=https%3A%2F%2Fexample.com%2Fdata.csv");
    });

    it("supports replace mode", async () => {
      let modeParam: string | null = null;

      server.use(
        http.post(`${BASE_URL}/v0/datasources`, async ({ request }) => {
          const url = new URL(request.url);
          modeParam = url.searchParams.get("mode");
          return HttpResponse.json({ successful_rows: 1, quarantined_rows: 0 });
        })
      );

      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      await api.appendDatasource(
        "events",
        { url: "https://example.com/data.csv" },
        { mode: "replace" }
      );

      expect(modeParam).toBe("replace");
    });

    it("detects ndjson format from URL extension", async () => {
      let formatParam: string | null = null;

      server.use(
        http.post(`${BASE_URL}/v0/datasources`, async ({ request }) => {
          const url = new URL(request.url);
          formatParam = url.searchParams.get("format");
          return HttpResponse.json({ successful_rows: 1, quarantined_rows: 0 });
        })
      );

      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      await api.appendDatasource("events", {
        url: "https://example.com/data.ndjson",
      });

      expect(formatParam).toBe("ndjson");
    });

    it("detects jsonl as ndjson format", async () => {
      let formatParam: string | null = null;

      server.use(
        http.post(`${BASE_URL}/v0/datasources`, async ({ request }) => {
          const url = new URL(request.url);
          formatParam = url.searchParams.get("format");
          return HttpResponse.json({ successful_rows: 1, quarantined_rows: 0 });
        })
      );

      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      await api.appendDatasource("events", {
        url: "https://example.com/data.jsonl",
      });

      expect(formatParam).toBe("ndjson");
    });

    it("detects parquet format from URL extension", async () => {
      let formatParam: string | null = null;

      server.use(
        http.post(`${BASE_URL}/v0/datasources`, async ({ request }) => {
          const url = new URL(request.url);
          formatParam = url.searchParams.get("format");
          return HttpResponse.json({ successful_rows: 1, quarantined_rows: 0 });
        })
      );

      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      await api.appendDatasource("events", {
        url: "https://example.com/data.parquet",
      });

      expect(formatParam).toBe("parquet");
    });

    it("strips query string when detecting format", async () => {
      let formatParam: string | null = null;

      server.use(
        http.post(`${BASE_URL}/v0/datasources`, async ({ request }) => {
          const url = new URL(request.url);
          formatParam = url.searchParams.get("format");
          return HttpResponse.json({ successful_rows: 1, quarantined_rows: 0 });
        })
      );

      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      await api.appendDatasource("events", {
        url: "https://example.com/data.csv?token=abc",
      });

      expect(formatParam).toBe("csv");
    });

    it("includes CSV dialect options", async () => {
      let delimiterParam: string | null = null;
      let newLineParam: string | null = null;
      let escapeCharParam: string | null = null;

      server.use(
        http.post(`${BASE_URL}/v0/datasources`, async ({ request }) => {
          const url = new URL(request.url);
          delimiterParam = url.searchParams.get("dialect_delimiter");
          newLineParam = url.searchParams.get("dialect_new_line");
          escapeCharParam = url.searchParams.get("dialect_escapechar");
          return HttpResponse.json({ successful_rows: 1, quarantined_rows: 0 });
        })
      );

      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      await api.appendDatasource("events", {
        url: "https://example.com/data.csv",
        csvDialect: {
          delimiter: ";",
          newLine: "\r\n",
          escapeChar: "\\",
        },
      });

      expect(delimiterParam).toBe(";");
      expect(newLineParam).toBe("\r\n");
      expect(escapeCharParam).toBe("\\");
    });

    it("throws error when neither url nor file is provided", async () => {
      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      await expect(api.appendDatasource("events", {})).rejects.toThrow(
        "Either 'url' or 'file' must be provided in options"
      );
    });

    it("throws error when both url and file are provided", async () => {
      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      await expect(
        api.appendDatasource("events", {
          url: "https://example.com/data.csv",
          file: "./data.csv",
        })
      ).rejects.toThrow("Only one of 'url' or 'file' can be provided, not both");
    });

    it("allows per-request token override", async () => {
      let authorizationHeader: string | null = null;

      server.use(
        http.post(`${BASE_URL}/v0/datasources`, async ({ request }) => {
          authorizationHeader = request.headers.get("Authorization");
          return HttpResponse.json({ successful_rows: 1, quarantined_rows: 0 });
        })
      );

      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      await api.appendDatasource(
        "events",
        { url: "https://example.com/data.csv" },
        { token: "p.override-token" }
      );

      expect(authorizationHeader).toBe("Bearer p.override-token");
    });
  });

  describe("deleteDatasource", () => {
    it("deletes rows from datasource with condition", async () => {
      let deleteConditionParam: string | null = null;
      let dryRunParam: string | null = null;

      server.use(
        http.post(`${BASE_URL}/v0/datasources/events/delete`, async ({ request }) => {
          const body = new URLSearchParams(await request.text());
          deleteConditionParam = body.get("delete_condition");
          dryRunParam = body.get("dry_run");

          return HttpResponse.json({
            id: "delete_123",
            job_id: "delete_123",
            job_url: "https://api.tinybird.co/v0/jobs/delete_123",
            status: "working",
          });
        })
      );

      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      const result = await api.deleteDatasource("events", {
        deleteCondition: "event_type = 'test'",
      });

      expect(result).toEqual({
        id: "delete_123",
        job_id: "delete_123",
        job_url: "https://api.tinybird.co/v0/jobs/delete_123",
        status: "working",
      });
      expect(deleteConditionParam).toBe("event_type = 'test'");
      expect(dryRunParam).toBeNull();
    });

    it("includes dry_run option when provided", async () => {
      let dryRunParam: string | null = null;

      server.use(
        http.post(`${BASE_URL}/v0/datasources/events/delete`, async ({ request }) => {
          const body = new URLSearchParams(await request.text());
          dryRunParam = body.get("dry_run");
          return HttpResponse.json({ rows_to_be_deleted: 3 });
        })
      );

      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      await api.deleteDatasource("events", {
        deleteCondition: "event_type = 'test'",
        dryRun: true,
      });

      expect(dryRunParam).toBe("true");
    });

    it("throws error when deleteCondition is missing", async () => {
      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      await expect(
        api.deleteDatasource("events", {
          deleteCondition: "   ",
        })
      ).rejects.toThrow("'deleteCondition' must be provided in options");
    });

    it("allows per-request token override", async () => {
      let authorizationHeader: string | null = null;

      server.use(
        http.post(`${BASE_URL}/v0/datasources/events/delete`, async ({ request }) => {
          authorizationHeader = request.headers.get("Authorization");
          return HttpResponse.json({ id: "delete_123" });
        })
      );

      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      await api.deleteDatasource(
        "events",
        { deleteCondition: "event_type = 'test'" },
        { token: "p.override-token" }
      );

      expect(authorizationHeader).toBe("Bearer p.override-token");
    });
  });

  describe("truncateDatasource", () => {
    it("truncates a datasource", async () => {
      let called = false;

      server.use(
        http.post(`${BASE_URL}/v0/datasources/events/truncate`, () => {
          called = true;
          return HttpResponse.json({ status: "ok" });
        })
      );

      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      const result = await api.truncateDatasource("events");

      expect(called).toBe(true);
      expect(result).toEqual({ status: "ok" });
    });

    it("returns empty object when API returns empty body", async () => {
      server.use(
        http.post(`${BASE_URL}/v0/datasources/events/truncate`, () => {
          return new HttpResponse(null, { status: 200 });
        })
      );

      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      const result = await api.truncateDatasource("events");

      expect(result).toEqual({});
    });

    it("allows per-request token override", async () => {
      let authorizationHeader: string | null = null;

      server.use(
        http.post(`${BASE_URL}/v0/datasources/events/truncate`, ({ request }) => {
          authorizationHeader = request.headers.get("Authorization");
          return HttpResponse.json({});
        })
      );

      const api = createTinybirdApi({
        baseUrl: BASE_URL,
        token: "p.default-token",
      });

      await api.truncateDatasource(
        "events",
        {},
        { token: "p.override-token" }
      );

      expect(authorizationHeader).toBe("Bearer p.override-token");
    });
  });
});
