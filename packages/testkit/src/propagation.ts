/**
 * The propagation gate: one context id goes from a client to a server, and from there to the spans, the log
 * records and the metrics. The gate runs one call on each transport and examines what the telemetry recorded.
 *
 * This entry uses the OpenTelemetry API only. The program under test registers the context manager, the
 * propagator and the processors, and gives the records through a `PropagationCapture`.
 *
 * @packageDocumentation
 */
import { context, metrics, propagation, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";

/** One transport of the gate: it makes one call from the client side to `handler` on the server side. */
export interface PropagationTransport {
  /** The name of the transport in the report, for example `http`. */
  readonly name: string;
  /**
   * This function sends one call in the active context, and runs `handler` on the server side of the call.
   * It resolves when the handler is complete.
   */
  readonly call?: (handler: () => Promise<void>) => Promise<void>;
  /** The reason why the test cannot reach this transport. The report then has a "no read" line, not a pass. */
  readonly noRead?: string;
}

/** A finished span, with the fields that the gate reads */
export interface PropagationSpan {
  readonly name: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  spanContext(): { readonly traceId: string };
}

/** A log record, with the fields that the gate reads */
export interface PropagationLogRecord {
  readonly body?: unknown;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly spanContext?: { readonly traceId: string } | undefined;
}

/** A metric data point, with the fields that the gate reads */
export interface PropagationMetricPoint {
  readonly name: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

/** The telemetry records of the program under test, for example from the in-memory exporters of the SDK */
export interface PropagationCapture {
  spans(): readonly PropagationSpan[] | Promise<readonly PropagationSpan[]>;
  logRecords(): readonly PropagationLogRecord[] | Promise<readonly PropagationLogRecord[]>;
  metricPoints(): readonly PropagationMetricPoint[] | Promise<readonly PropagationMetricPoint[]>;
  /** This function removes all records, before each call of the gate. */
  reset(): void | Promise<void>;
}

/** The options of `propagationGate` */
export interface PropagationGateOptions {
  /** The context key that the gate sends, for example `request.id`. */
  readonly key: string;
  readonly transports: readonly PropagationTransport[];
  readonly capture: PropagationCapture;
  /**
   * This function runs `fn` in a context with the value of `key`. The default puts the value in the baggage.
   * Give `withContext` of the program when it adds the value in a different way.
   */
  readonly withValue?: <T>(key: string, value: string, fn: () => T) => T;
  /** This function reads the value of `key` in the active context. The default reads the baggage. */
  readonly readValue?: (key: string) => string | undefined;
  /** The cardinality of `key`. A metric has no attribute of a key with `high`. Default: `high`. */
  readonly cardinality?: "low" | "high";
  /**
   * This function makes a broken copy of each transport. The gate runs the copy too, and the copy must fail.
   * Default: `losingContext`. Give `false` to run no copy.
   */
  readonly flip?: false | ((transport: PropagationTransport) => PropagationTransport);
}

/** The result of one transport */
export interface PropagationLine {
  readonly transport: string;
  readonly verdict: "pass" | "fail" | "no read";
  /** Each claim that failed. For a "no read" line, the reason. */
  readonly faults: readonly string[];
}

/** The result of the gate */
export interface PropagationReport {
  readonly key: string;
  readonly lines: readonly PropagationLine[];
  /** True when no line failed. A "no read" line is not a failure, but it is not a pass. */
  readonly ok: boolean;
}

/** The names that the gate uses for its own records */
export const GATE_NAMES = {
  tracer: "@mark1russell7/rigor-testkit/propagation",
  clientSpan: "rigor.gate.client",
  handlerSpan: "rigor.gate.handler",
  logBody: "rigor.gate.handler",
  counter: "rigor.gate.calls",
  transportAttribute: "rigor.gate.transport",
} as const;

function baggageWith<T>(key: string, value: string, fn: () => T): T {
  const active = context.active();
  const baggage = (propagation.getBaggage(active) ?? propagation.createBaggage()).setEntry(key, { value });
  return context.with(propagation.setBaggage(active, baggage), fn);
}

function baggageRead(key: string): string | undefined {
  return propagation.getBaggage(context.active())?.getEntry(key)?.value;
}

/** A copy of `transport` that runs the handler in the root context: the context is lost on the way. */
export function losingContext(transport: PropagationTransport): PropagationTransport {
  const call = transport.call;
  if (call === undefined) return transport;
  return { name: `${transport.name} (context lost)`, call: (handler) => call(() => context.with(ROOT_CONTEXT, handler)) };
}

/**
 * The transport `local`: it injects the active context into a carrier, extracts it from the carrier, and runs
 * the handler in the extracted context. Thus it tests the registered propagator without a network.
 *
 * @param internalCall - This function marks the call as internal, for a propagator that sends the baggage
 *   only on internal calls. Give `withInternalCall` of the program. The default adds no mark.
 */
export function localTransport(internalCall: <T>(fn: () => T) => T = (fn) => fn()): PropagationTransport {
  return {
    name: "local",
    async call(handler) {
      const carrier: Record<string, string> = {};
      internalCall(() => propagation.inject(context.active(), carrier));
      await context.with(propagation.extract(ROOT_CONTEXT, carrier), handler);
    },
  };
}

interface Observed {
  readonly seen: string | undefined;
  readonly thirdParty: Record<string, string>;
}

async function runOne(transport: PropagationTransport, call: NonNullable<PropagationTransport["call"]>, value: string, options: PropagationGateOptions): Promise<string[]> {
  const { key, capture } = options;
  const withValue = options.withValue ?? baggageWith;
  const readValue = options.readValue ?? baggageRead;
  const tracer = trace.getTracer(GATE_NAMES.tracer);
  const counter = metrics.getMeter(GATE_NAMES.tracer).createCounter(GATE_NAMES.counter);
  const logger = logs.getLogger(GATE_NAMES.tracer);
  await capture.reset();

  let observed: Observed | undefined;
  const handler = async (): Promise<void> => {
    await tracer.startActiveSpan(GATE_NAMES.handlerSpan, async (span) => {
      try {
        await null;
        logger.emit({ body: GATE_NAMES.logBody });
        counter.add(1, { [key]: value, [GATE_NAMES.transportAttribute]: transport.name });
        const thirdParty: Record<string, string> = {};
        propagation.inject(context.active(), thirdParty);
        observed = { seen: readValue(key), thirdParty };
      } finally {
        span.end();
      }
    });
  };

  let clientTrace = "";
  const faults: string[] = [];
  try {
    await withValue(key, value, () =>
      tracer.startActiveSpan(GATE_NAMES.clientSpan, async (span) => {
        clientTrace = span.spanContext().traceId;
        try {
          await call(handler);
        } finally {
          span.end();
        }
      }),
    );
  } catch (error) {
    return [`the call failed: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (observed === undefined) return ["the handler did not run"];

  if (observed.seen !== value) faults.push(`the handler read ${JSON.stringify(observed.seen)} for ${key}, not ${JSON.stringify(value)}`);
  const handlerSpan = (await capture.spans()).find((span) => span.name === GATE_NAMES.handlerSpan);
  if (handlerSpan === undefined) {
    faults.push("no span of the handler was recorded");
  } else {
    if (handlerSpan.spanContext().traceId !== clientTrace) faults.push("the span of the handler is not in the trace of the client");
    if (handlerSpan.attributes[key] !== value) faults.push(`the span of the handler has no attribute ${key}=${value}`);
  }
  const record = (await capture.logRecords()).find((log) => log.body === GATE_NAMES.logBody);
  if (record === undefined) {
    faults.push("no log record of the handler was recorded");
  } else {
    if (record.spanContext?.traceId !== clientTrace) faults.push("the log record of the handler is not in the trace of the client");
    if (record.attributes[key] !== value) faults.push(`the log record of the handler has no attribute ${key}=${value}`);
  }
  const points = (await capture.metricPoints()).filter((point) => point.name === GATE_NAMES.counter && point.attributes[GATE_NAMES.transportAttribute] === transport.name);
  if (points.length === 0) {
    faults.push("no metric point of the handler was recorded");
  } else if ((options.cardinality ?? "high") === "high" && points.some((point) => key in point.attributes)) {
    faults.push(`a metric point has the attribute ${key}, a key of high cardinality`);
  }
  if ("baggage" in observed.thirdParty) faults.push(`a call to a third party from the handler has the header baggage: ${observed.thirdParty["baggage"]}`);
  return faults;
}

/**
 * This function runs one call on each transport and examines the records. A transport with `noRead` gets a
 * "no read" line. The broken copy of each transport that `flip` makes must fail, or the line fails.
 */
export async function propagationGate(options: PropagationGateOptions): Promise<PropagationReport> {
  const lines: PropagationLine[] = [];
  let index = 0;
  for (const transport of options.transports) {
    if (transport.call === undefined) {
      lines.push({ transport: transport.name, verdict: "no read", faults: [transport.noRead ?? "the transport has no call"] });
      continue;
    }
    const value = `gate-${++index}`;
    const faults = await runOne(transport, transport.call, value, options);
    const flip = options.flip ?? losingContext;
    if (faults.length === 0 && flip !== false) {
      const broken = flip(transport);
      const flipFaults = broken.call === undefined ? ["no call"] : await runOne(broken, broken.call, `gate-${++index}`, options);
      if (flipFaults.length === 0) faults.push(`the broken copy "${broken.name}" also passed, so the gate cannot see a lost context on this transport`);
    }
    lines.push({ transport: transport.name, verdict: faults.length === 0 ? "pass" : "fail", faults });
  }
  return { key: options.key, lines, ok: lines.every((line) => line.verdict !== "fail") };
}

/** The report as Markdown lines, for the summary of a CI job or a pull request */
export function formatPropagationReport(report: PropagationReport): string {
  const rows = report.lines.map((line) => `| ${line.transport} | ${line.verdict} | ${line.faults.join("; ").replaceAll("|", "\\|") || "-"} |`);
  return [`Propagation gate of \`${report.key}\`: ${report.ok ? "no failure" : "FAILED"}`, "", "| Transport | Verdict | Faults |", "| --- | --- | --- |", ...rows].join("\n");
}
