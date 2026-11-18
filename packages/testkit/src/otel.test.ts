import { afterEach, describe, expect, it } from "vitest";
import { logs, metrics, trace } from "@opentelemetry/api";
import { logs as sdk2Logs } from "@opentelemetry/api-logs";
import { BatchLogRecordProcessor, LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { SimpleSpanProcessor, TracerProvider, type SpanProcessor } from "@opentelemetry/sdk-trace";
import { logsApis } from "./logs-api.ts";
import { captureTelemetry, type TelemetryCapture } from "./otel.ts";
import type { PropagationCapture } from "./propagation.ts";

/** This function writes one span, one log record and one metric point through the global API. */
const writeOneOfEach = (): void => {
  trace.getTracer("test").startActiveSpan("work", (span) => span.end());
  logs.getLogger("test").emit({ body: "a log" });
  metrics.getMeter("test").createCounter("calls").add(1, { route: "/a" });
};

/** This function gives the names of the records in the capture. */
const recordsOf = async (capture: TelemetryCapture) => ({
  spans: (await capture.spans()).map((span) => span.name),
  logs: (await capture.logRecords()).map((record) => record.body),
  metrics: await capture.metricPoints(),
});

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

describe("captureTelemetry with the providers of the capture", () => {
  it("gets a span, a log record and a metric point, and reset() removes all three", async () => {
    const capture = captureTelemetry();
    const unregister = capture.register();
    cleanup = async () => {
      unregister();
      await capture.shutdown();
    };

    writeOneOfEach();
    expect(await recordsOf(capture)).toEqual({
      spans: ["work"],
      logs: ["a log"],
      metrics: [{ name: "calls", attributes: { route: "/a" } }],
    });

    writeOneOfEach();
    await capture.reset();
    expect(await recordsOf(capture)).toEqual({ spans: [], logs: [], metrics: [] });
  });

  it("runs the processors of the program before the processor of the capture", async () => {
    const tagging: SpanProcessor = {
      onStart: (span) => span.setAttribute("tagged", true),
      onEnd() {},
      forceFlush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    };
    const capture = captureTelemetry({ spanProcessors: [tagging], views: [{ instrumentName: "calls", attributesProcessors: [{ process: () => ({}) }] }] });
    cleanup = () => capture.shutdown();

    capture.tracerProvider.getTracer("test").startSpan("work").end();
    capture.meterProvider.getMeter("test").createCounter("calls").add(1, { route: "/a" });

    expect((await capture.spans())[0]?.attributes).toEqual({ tagged: true });
    expect(await capture.metricPoints()).toEqual([{ name: "calls", attributes: {} }]);
  });

  it("gives each metric point one time: a collection removes the points that it gives", async () => {
    const capture = captureTelemetry();
    cleanup = () => capture.shutdown();
    const counter = capture.meterProvider.getMeter("test").createCounter("calls");

    counter.add(1);
    expect(await capture.metricPoints()).toHaveLength(1);
    expect(await capture.metricPoints()).toEqual([]);
  });

  it("sets its logger provider in each logs API: a record through either API comes to the capture one time", async () => {
    const capture = captureTelemetry();
    const unregister = capture.register();
    cleanup = async () => {
      unregister();
      await capture.shutdown();
    };

    logs.getLogger("test").emit({ body: "through @opentelemetry/api" });
    sdk2Logs.getLogger("test").emit({ body: "through @opentelemetry/api-logs" });
    const both = ["through @opentelemetry/api", "through @opentelemetry/api-logs"];
    expect((await capture.logRecords()).map((record) => record.body)).toEqual(both);

    // After unregister(), neither API has the provider of the capture
    unregister();
    logs.getLogger("test").emit({ body: "late" });
    sdk2Logs.getLogger("test").emit({ body: "late" });
    expect((await capture.logRecords()).map((record) => record.body)).toEqual(both);
  });

  it("is a capture of the propagation gate", () => {
    const capture: PropagationCapture = captureTelemetry({ sdk: "external" });
    expect(typeof capture.reset).toBe("function");
  });
});

describe("captureTelemetry with the SDK of the program under test", () => {
  it("gets the records of the SDK that uses its exporters and its reader, and reset() removes all three", async () => {
    const capture = captureTelemetry({ sdk: "external" });
    // The SDK of the program under test, for example startNodeTelemetry() of otel-ts
    const tracerProvider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: capture.spanExporter })] });
    const loggerProvider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter: capture.logExporter })] });
    const meterProvider = new MeterProvider({ readers: [capture.metricReader] });
    trace.setGlobalTracerProvider(tracerProvider);
    logs.setGlobalLoggerProvider(loggerProvider);
    metrics.setGlobalMeterProvider(meterProvider);
    cleanup = async () => {
      trace.disable();
      logs.disable();
      metrics.disable();
      await Promise.all([tracerProvider.shutdown(), loggerProvider.shutdown(), meterProvider.shutdown()]);
    };

    writeOneOfEach();
    expect(await recordsOf(capture)).toEqual({
      spans: ["work"],
      logs: ["a log"],
      metrics: [{ name: "calls", attributes: { route: "/a" } }],
    });

    writeOneOfEach();
    await capture.reset();
    expect(await recordsOf(capture)).toEqual({ spans: [], logs: [], metrics: [] });
  });

  it("flushes an SDK 2 that sets its logger provider in the logs API of @opentelemetry/api-logs", async () => {
    const capture = captureTelemetry({ sdk: "external" });
    // A batch that does not export by itself: the records come only with the flush of the capture
    const loggerProvider = new LoggerProvider({ processors: [new BatchLogRecordProcessor({ exporter: capture.logExporter, scheduledDelayMillis: 3_600_000 })] });
    sdk2Logs.setGlobalLoggerProvider(loggerProvider);
    cleanup = async () => {
      sdk2Logs.disable();
      await loggerProvider.shutdown();
    };

    sdk2Logs.getLogger("test").emit({ body: "a log" });
    expect(capture.logExporter.getFinishedLogRecords()).toEqual([]);
    expect((await capture.logRecords()).map((record) => record.body)).toEqual(["a log"]);

    sdk2Logs.getLogger("test").emit({ body: "a second log" });
    await capture.reset();
    expect(await capture.logRecords()).toEqual([]);
  });

  it("resets before the SDK starts", async () => {
    const capture = captureTelemetry({ sdk: "external" });
    await expect(capture.reset()).resolves.toBeUndefined();
    expect(await capture.spans()).toEqual([]);
  });
});

describe("the logs APIs", () => {
  const notFound = (): never => {
    throw Object.assign(new Error("Cannot find module"), { code: "MODULE_NOT_FOUND" });
  };

  it("gives the API of @opentelemetry/api, then the API of @opentelemetry/api-logs of the program", () => {
    expect(logsApis()).toEqual([logs, sdk2Logs]);
    expect(logsApis()[1]).toBe(sdk2Logs);
  });

  it("gives only the API of @opentelemetry/api when the program does not install @opentelemetry/api-logs", () => {
    expect(logsApis(notFound)).toEqual([logs]);
  });

  it("gives each other error of the load to the caller", () => {
    const broken = (): never => {
      throw new SyntaxError("Unexpected token");
    };
    expect(() => logsApis(broken)).toThrow(SyntaxError);
  });
});
