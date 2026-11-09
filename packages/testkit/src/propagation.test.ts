import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  context,
  createContextKey,
  metrics,
  propagation,
  trace,
  type Context,
  type TextMapGetter,
  type TextMapPropagator,
  type TextMapSetter,
} from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CBaggagePropagator, W3CTraceContextPropagator } from "@opentelemetry/core";
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor, type LogRecordProcessor } from "@opentelemetry/sdk-logs";
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  formatPropagationReport,
  localTransport,
  losingContext,
  propagationGate,
  type PropagationCapture,
  type PropagationTransport,
} from "./propagation.ts";

// A small program under test: the rules of otel-ts in a few lines. The baggage goes only on an internal call.
const KEY = "request.id";
const INTERNAL = createContextKey("test internal call");
const internalCall = <T>(fn: () => T): T => context.with(context.active().setValue(INTERNAL, true), fn);

class InternalOnlyPropagator implements TextMapPropagator {
  private readonly traceContext = new W3CTraceContextPropagator();
  private readonly baggage = new W3CBaggagePropagator();
  inject(from: Context, carrier: unknown, setter: TextMapSetter): void {
    this.traceContext.inject(from, carrier, setter);
    if (from.getValue(INTERNAL) === true) this.baggage.inject(from, carrier, setter);
  }
  extract(from: Context, carrier: unknown, getter: TextMapGetter): Context {
    return this.baggage.extract(this.traceContext.extract(from, carrier, getter), carrier, getter);
  }
  fields(): string[] {
    return [...this.traceContext.fields(), ...this.baggage.fields()];
  }
}

const copyBaggage = (from: Context): Record<string, string> =>
  Object.fromEntries((propagation.getBaggage(from)?.getAllEntries() ?? []).map(([key, entry]) => [key, entry.value]));
const spanProcessor: SpanProcessor = {
  onStart: (span, parent) => span.setAttributes(copyBaggage(parent)),
  onEnd() {},
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};
const logProcessor: LogRecordProcessor = {
  onEmit: (record, from) => record.setAttributes(copyBaggage(from ?? context.active())),
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

const spans = new InMemorySpanExporter();
const logRecords = new InMemoryLogRecordExporter();
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
const reader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 3_600_000 });
const tracerProvider = new BasicTracerProvider({ spanProcessors: [spanProcessor, new SimpleSpanProcessor(spans)] });
const loggerProvider = new LoggerProvider({ processors: [logProcessor, new SimpleLogRecordProcessor(logRecords)] });
const meterProvider = new MeterProvider({
  readers: [reader],
  views: [{ instrumentName: "*", attributesProcessors: [{ process: ({ [KEY]: _removed, ...rest }) => rest }] }],
});

const capture: PropagationCapture = {
  spans: () => spans.getFinishedSpans(),
  logRecords: () => logRecords.getFinishedLogRecords(),
  async metricPoints() {
    await reader.forceFlush();
    return metricExporter.getMetrics().flatMap((resource) =>
      resource.scopeMetrics.flatMap((scope) => scope.metrics.flatMap((metric) => metric.dataPoints.map((point) => ({ name: metric.descriptor.name, attributes: point.attributes })))),
    );
  },
  reset() {
    spans.reset();
    logRecords.reset();
    metricExporter.reset();
  },
};

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new InternalOnlyPropagator());
  trace.setGlobalTracerProvider(tracerProvider);
  logs.setGlobalLoggerProvider(loggerProvider);
  metrics.setGlobalMeterProvider(meterProvider);
});

afterAll(async () => {
  await Promise.all([tracerProvider.shutdown(), loggerProvider.shutdown(), meterProvider.shutdown()]);
  trace.disable();
  metrics.disable();
  logs.disable();
  propagation.disable();
  context.disable();
});

beforeEach(() => capture.reset());

describe("propagationGate", () => {
  it("passes a transport that keeps the context, and lists a transport that the test cannot reach as no read", async () => {
    const report = await propagationGate({
      key: KEY,
      capture,
      transports: [localTransport(internalCall), { name: "port", noRead: "no worker in this test" }],
    });

    expect(report.lines).toEqual([
      { transport: "local", verdict: "pass", faults: [] },
      { transport: "port", verdict: "no read", faults: ["no worker in this test"] },
    ]);
    expect(report.ok).toBe(true);
  });

  it("fails a transport that sends no baggage: the handler does not read the id", async () => {
    const report = await propagationGate({ key: KEY, capture, transports: [localTransport()] });

    expect(report.ok).toBe(false);
    expect(report.lines[0]?.faults).toContain('the handler read undefined for request.id, not "gate-1"');
  });

  it("fails a transport that drops the traceparent header", async () => {
    const dropsTrace: PropagationTransport = {
      name: "drops traceparent",
      async call(handler) {
        const carrier: Record<string, string> = {};
        internalCall(() => propagation.inject(context.active(), carrier));
        delete carrier["traceparent"];
        await context.with(propagation.extract(context.active(), carrier), () => context.with(trace.deleteSpan(context.active()), handler));
      },
    };
    const report = await propagationGate({ key: KEY, capture, transports: [dropsTrace] });

    expect(report.lines[0]?.faults).toEqual([
      "the span of the handler is not in the trace of the client",
      "the log record of the handler is not in the trace of the client",
    ]);
  });

  it("fails when a third-party call of the handler gets the baggage", async () => {
    const everywhere: PropagationTransport = {
      name: "internal everywhere",
      call: (handler) => localTransport(internalCall).call!(() => internalCall(handler)),
    };
    const report = await propagationGate({ key: KEY, capture, transports: [everywhere] });

    expect(report.lines[0]?.faults).toEqual(["a call to a third party from the handler has the header baggage: request.id=gate-1"]);
  });

  it("fails when the metric keeps a key of high cardinality, and accepts it for a key of low cardinality", async () => {
    const other = "tenant.id";
    const high = await propagationGate({ key: other, capture, transports: [localTransport(internalCall)] });
    const low = await propagationGate({ key: other, capture, transports: [localTransport(internalCall)], cardinality: "low" });

    expect(high.lines[0]?.faults).toEqual(["a metric point has the attribute tenant.id, a key of high cardinality"]);
    expect(low.ok).toBe(true);
  });

  it("runs the broken copy of each passing transport, and the copy fails", async () => {
    let calls = 0;
    const counted = localTransport(internalCall);
    const transport: PropagationTransport = { name: "local", call: (handler) => (calls++, counted.call!(handler)) };

    expect((await propagationGate({ key: KEY, capture, transports: [transport] })).ok).toBe(true);
    expect(calls).toBe(2);
    const lost = await propagationGate({ key: KEY, capture, transports: [losingContext(transport)], flip: false });
    expect(lost.lines[0]?.faults).toContain('the handler read undefined for request.id, not "gate-1"');
  });

  it("fails a transport when its broken copy passes too (the flip)", async () => {
    const report = await propagationGate({ key: KEY, capture, transports: [localTransport(internalCall)], flip: (transport) => ({ ...transport, name: "not broken" }) });

    expect(report.lines[0]).toEqual({
      transport: "local",
      verdict: "fail",
      faults: ['the broken copy "not broken" also passed, so the gate cannot see a lost context on this transport'],
    });
  });

  it("formats the report as a Markdown table", async () => {
    const report = await propagationGate({ key: KEY, capture, transports: [{ name: "mcp", noRead: "no server" }] });

    expect(formatPropagationReport(report)).toBe(
      ["Propagation gate of `request.id`: no failure", "", "| Transport | Verdict | Faults |", "| --- | --- | --- |", "| mcp | no read | no server |"].join("\n"),
    );
  });
});
