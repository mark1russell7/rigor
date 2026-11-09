/**
 * The capture of the OpenTelemetry SDK for tests. It has in-memory exporters for the spans and the log records.
 * Its metric reader collects only when the test asks. A test reads the records, and `reset()` removes them.
 *
 * The capture works in two modes. With `sdk: "own"` (the default), it makes a tracer provider, a logger provider
 * and a meter provider with the exporters and the reader. With `sdk: "external"`, the program under test starts
 * its own SDK with the exporters and the reader of the capture, for example `startNodeTelemetry()` of otel-ts.
 *
 * The object that `captureTelemetry()` returns is also a `PropagationCapture` of the entry `/propagation`.
 *
 * @packageDocumentation
 */
import { metrics, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
  type LogRecordProcessor,
  type ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import { AggregationTemporality, MeterProvider, MetricReader, type MetricProducer, type ViewOptions } from "@opentelemetry/sdk-metrics";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan, type SpanProcessor } from "@opentelemetry/sdk-trace-base";

/** A metric data point: the name of its metric and its attributes */
export interface OtelMetricPoint {
  readonly name: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

/** The options of `captureTelemetry` when the capture makes the providers */
export interface OwnSdkCaptureOptions {
  /** The capture makes the tracer, logger and meter providers. This is the default. */
  readonly sdk?: "own";
  /** The span processors of the program under test. They run before the processor of the capture. */
  readonly spanProcessors?: readonly SpanProcessor[];
  /** The log record processors of the program under test. They run before the processor of the capture. */
  readonly logProcessors?: readonly LogRecordProcessor[];
  /** The metric views of the meter provider */
  readonly views?: readonly ViewOptions[];
}

/** The options of `captureTelemetry` when the program under test starts the SDK */
export interface ExternalSdkCaptureOptions {
  /** The program under test starts the SDK with the exporters and the reader of the capture. */
  readonly sdk: "external";
}

/** The records of the SDK for a test */
export interface TelemetryCapture {
  /** The exporter of the spans. With `sdk: "external"`, give it to the SDK as its trace exporter. */
  readonly spanExporter: InMemorySpanExporter;
  /** The exporter of the log records. With `sdk: "external"`, give it to the SDK as its log exporter. */
  readonly logExporter: InMemoryLogRecordExporter;
  /**
   * The metric reader. It collects only when the test asks, with the delta temporality. Thus each collection
   * gives the points after the last collection. With `sdk: "external"`, give it to the SDK as a metric reader.
   */
  readonly metricReader: MetricReader;
  /** This function flushes the tracer provider and gives the finished spans. */
  spans(): Promise<readonly ReadableSpan[]>;
  /** This function flushes the logger provider and gives the log records. */
  logRecords(): Promise<readonly ReadableLogRecord[]>;
  /** This function collects the metrics and gives the data points after the last collection. */
  metricPoints(): Promise<readonly OtelMetricPoint[]>;
  /** This function removes all spans, log records and metric points. */
  reset(): Promise<void>;
}

/** The records of the SDK for a test, with the providers that the capture made */
export interface OwnSdkTelemetryCapture extends TelemetryCapture {
  readonly tracerProvider: BasicTracerProvider;
  readonly loggerProvider: LoggerProvider;
  readonly meterProvider: MeterProvider;
  /**
   * This function sets the three providers as the global providers of the OpenTelemetry API. The function that
   * it returns removes the global providers.
   */
  register(): () => void;
  /** This function stops the three providers. */
  shutdown(): Promise<void>;
}

/** A metric reader that collects only when the test asks */
class PullMetricReader extends MetricReader {
  /** This field is true after an SDK registers the reader. Before that, the reader cannot collect. */
  bound = false;

  constructor() {
    super({ aggregationTemporalitySelector: () => AggregationTemporality.DELTA });
  }

  override setMetricProducer(producer: MetricProducer): void {
    super.setMetricProducer(producer);
    this.bound = true;
  }

  protected override async onForceFlush(): Promise<void> {}
  protected override async onShutdown(): Promise<void> {}
}

/** This function flushes a provider. For a proxy provider of the global API, it flushes the delegate. */
const flush = async (provider: object): Promise<void> => {
  const real = "getDelegate" in provider && typeof provider.getDelegate === "function" ? (provider.getDelegate() as object) : provider;
  if ("forceFlush" in real && typeof real.forceFlush === "function") await (real.forceFlush as () => Promise<void>).call(real);
};

/**
 * This function makes a capture of the spans, the log records and the metric points of a test.
 *
 * ```ts no-run
 * const capture = captureTelemetry({ spanProcessors: [createContextSpanProcessor()] });
 * const unregister = capture.register();
 * trace.getTracer("test").startActiveSpan("work", (span) => span.end());
 * expect((await capture.spans()).map((span) => span.name)).toEqual(["work"]);
 * ```
 */
export function captureTelemetry(options?: OwnSdkCaptureOptions): OwnSdkTelemetryCapture;
export function captureTelemetry(options: ExternalSdkCaptureOptions): TelemetryCapture;
export function captureTelemetry(options: OwnSdkCaptureOptions | ExternalSdkCaptureOptions = {}): TelemetryCapture | OwnSdkTelemetryCapture {
  const spanExporter = new InMemorySpanExporter();
  const logExporter = new InMemoryLogRecordExporter();
  const metricReader = new PullMetricReader();

  const metricPoints = async (): Promise<readonly OtelMetricPoint[]> => {
    const { resourceMetrics } = await metricReader.collect();
    return resourceMetrics.scopeMetrics.flatMap((scope) =>
      scope.metrics.flatMap((metric) =>
        (metric.dataPoints as readonly { attributes: Record<string, unknown> }[]).map((point) => ({ name: metric.descriptor.name, attributes: point.attributes })),
      ),
    );
  };

  /** This function removes the records, after a flush of the providers that `flushAll` names. */
  const resetWith = async (flushAll: () => Promise<void>): Promise<void> => {
    await flushAll();
    spanExporter.reset();
    logExporter.reset();
    // With the delta temporality, a collection removes the points. A reader that no SDK registered has no points.
    if (metricReader.bound) await metricReader.collect();
  };

  if (options.sdk === "external") {
    const flushGlobal = async (): Promise<void> => {
      await flush(trace.getTracerProvider());
      await flush(logs.getLoggerProvider());
    };
    return {
      spanExporter,
      logExporter,
      metricReader,
      spans: async () => {
        await flush(trace.getTracerProvider());
        return spanExporter.getFinishedSpans();
      },
      logRecords: async () => {
        await flush(logs.getLoggerProvider());
        return logExporter.getFinishedLogRecords();
      },
      metricPoints,
      reset: () => resetWith(flushGlobal),
    };
  }

  const tracerProvider = new BasicTracerProvider({ spanProcessors: [...(options.spanProcessors ?? []), new SimpleSpanProcessor(spanExporter)] });
  const loggerProvider = new LoggerProvider({ processors: [...(options.logProcessors ?? []), new SimpleLogRecordProcessor({ exporter: logExporter })] });
  const meterProvider = new MeterProvider({ readers: [metricReader], views: [...(options.views ?? [])] });
  const flushOwn = async (): Promise<void> => {
    await tracerProvider.forceFlush();
    await loggerProvider.forceFlush();
  };

  return {
    spanExporter,
    logExporter,
    metricReader,
    tracerProvider,
    loggerProvider,
    meterProvider,
    spans: async () => {
      await tracerProvider.forceFlush();
      return spanExporter.getFinishedSpans();
    },
    logRecords: async () => {
      await loggerProvider.forceFlush();
      return logExporter.getFinishedLogRecords();
    },
    metricPoints,
    reset: () => resetWith(flushOwn),
    register() {
      trace.setGlobalTracerProvider(tracerProvider);
      logs.setGlobalLoggerProvider(loggerProvider);
      metrics.setGlobalMeterProvider(meterProvider);
      return () => {
        trace.disable();
        logs.disable();
        metrics.disable();
      };
    },
    shutdown: async () => {
      await Promise.all([tracerProvider.shutdown(), loggerProvider.shutdown(), meterProvider.shutdown()]);
    },
  };
}
