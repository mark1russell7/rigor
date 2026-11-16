import { afterEach, describe, expect, it } from "vitest";
import { type OtlpCollector, OTLP_SIGNALS, startOtlpCollector } from "./otlp.ts";

const collectors: OtlpCollector[] = [];
afterEach(async () => {
  for (const collector of collectors.splice(0)) await collector.close();
});

const start = async (): Promise<OtlpCollector> => {
  const collector = await startOtlpCollector();
  collectors.push(collector);
  return collector;
};

const post = async (collector: OtlpCollector, path: string, body: unknown, fields: Record<string, string> = { "content-type": "application/json" }): Promise<Response> =>
  fetch(`${collector.endpoint}${path}`, { method: "POST", headers: fields, body: typeof body === "string" ? body : JSON.stringify(body) });

const traces = (scope: string, ...names: string[]) => ({
  resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name: scope, version: "1.0.0" }, spans: names.map((name) => ({ name, traceId: "00", spanId: "00" })) }] }],
});

describe("startOtlpCollector", () => {
  it("keeps the names of each scope of the spans, and replies 200 with {}", async () => {
    const collector = await start();
    expect(collector.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await post(collector, "/v1/traces", traces("@opentelemetry/instrumentation-http", "GET", "POST"));
    expect([response.status, await response.text(), response.headers.get("content-type")]).toEqual([200, "{}", "application/json"]);
    await post(collector, "/v1/traces", traces("@opentelemetry/instrumentation-http", "GET"));
    await post(collector, "/v1/traces", traces("@opentelemetry/instrumentation-pg", "pg.query"));
    expect(collector.exports()).toBe(3);
    expect(collector.unread()).toBe(0);
    expect(collector.counts()).toEqual(new Map([["@opentelemetry/instrumentation-http", 3], ["@opentelemetry/instrumentation-pg", 1]]));
    expect(collector.names("traces")).toEqual(
      new Map([
        ["@opentelemetry/instrumentation-http", new Set(["GET", "POST"])],
        ["@opentelemetry/instrumentation-pg", new Set(["pg.query"])],
      ]),
    );
    expect(collector.missing(["@opentelemetry/instrumentation-pg", "@opentelemetry/instrumentation-redis"])).toEqual(["@opentelemetry/instrumentation-redis"]);
  });

  it("reads the metrics and the log records, each signal apart", async () => {
    const collector = await start();
    await post(collector, "/v1/metrics", {
      resourceMetrics: [{ scopeMetrics: [{ scope: { name: "app" }, metrics: [{ name: "requests" }, { name: "latency" }] }, { scope: { name: "idle" }, metrics: [] }] }],
    });
    await post(collector, "/v1/logs", {
      resourceLogs: [{ scopeLogs: [{ scope: { name: "app" }, logRecords: [{ eventName: "start", body: { stringValue: "up" } }, { body: { stringValue: "text" } }] }, { logRecords: [{}] }] }],
    });
    expect(collector.exports("metrics")).toBe(1);
    expect(collector.names("metrics")).toEqual(new Map([["app", new Set(["requests", "latency"])]]));
    expect(collector.counts("logs")).toEqual(new Map([["app", 2], ["", 1]]));
    expect(collector.names("logs")).toEqual(new Map([["app", new Set(["start"])], ["", new Set()]]));
    expect(collector.missing(["app", "idle"], "metrics")).toEqual(["idle"]);
    expect(collector.exports("traces")).toBe(0);
    expect(collector.missing(["app"])).toEqual(["app"]);
  });

  it("counts an export that is not OTLP JSON as unread, and a request to another path as no export", async () => {
    const collector = await start();
    await post(collector, "/v1/traces", new Uint8Array([10, 2, 8, 1]) as unknown as string, { "content-type": "application/x-protobuf" });
    await post(collector, "/v1/traces", traces("x", "a"), { "content-type": "application/json", "content-encoding": "gzip" });
    await post(collector, "/v1/traces", "{not json");
    await post(collector, "/v1/traces", "[]");
    await post(collector, "/v1/traces", {});
    const other = await post(collector, "/v1/profiles", traces("x", "a"));
    expect(other.status).toBe(404);
    expect((await fetch(`${collector.endpoint}/v1/traces`)).status).toBe(404);
    expect([collector.exports(), collector.unread()]).toEqual([5, 4]);
    expect(collector.counts()).toEqual(new Map());
  });

  it("gives copies, so a caller cannot change the state", async () => {
    const collector = await start();
    await post(collector, "/v1/traces", traces("app", "a"));
    (collector.names().get("app") as Set<string>).add("b");
    (collector.counts() as Map<string, number>).set("app", 9);
    expect(collector.names().get("app")).toEqual(new Set(["a"]));
    expect(collector.counts().get("app")).toBe(1);
  });

  it("waits until each scope has an item, and pokes before each read", async () => {
    const collector = await start();
    let pokes = 0;
    const left = await collector.waitFor(["app"], {
      intervalMs: 5,
      poke: async () => {
        pokes += 1;
        if (pokes === 1) throw new Error("the service is not up");
        if (pokes === 3) await post(collector, "/v1/traces", traces("app", "work"));
      },
    });
    expect(left).toEqual([]);
    expect(pokes).toBe(3);
  });

  it("gives the scopes that are still missing at the end of the time", async () => {
    const collector = await start();
    await post(collector, "/v1/logs", { resourceLogs: [{ scopeLogs: [{ scope: { name: "app" }, logRecords: [{}] }] }] });
    const began = Date.now();
    expect(await collector.waitFor(["app", "db"], { signal: "logs", timeoutMs: 40, intervalMs: 10 })).toEqual(["db"]);
    expect(Date.now() - began).toBeLessThan(5000);
    expect(await collector.waitFor(["app"], { signal: "logs", timeoutMs: 0 })).toEqual([]);
  });

  it("refuses a bad signal and bad times", async () => {
    const collector = await start();
    expect(OTLP_SIGNALS).toEqual(["traces", "metrics", "logs"]);
    expect(() => collector.exports("spans" as never)).toThrow(RangeError);
    await expect(collector.waitFor([], { timeoutMs: -1 })).rejects.toThrow(RangeError);
    await expect(collector.waitFor([], { intervalMs: 0 })).rejects.toThrow(RangeError);
    await expect(collector.waitFor([], { signal: "profiles" as never })).rejects.toThrow(RangeError);
  });
});
