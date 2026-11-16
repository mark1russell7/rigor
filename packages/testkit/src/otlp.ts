/**
 * A stand-in OTLP/HTTP collector, for a check of a program in another process. The program exports to `endpoint`
 * with OTLP/HTTP JSON, and the collector keeps the names of each instrumentation scope of each signal.
 * A check of a service in CI uses it. A change of the load order can break the instrumentations with no error,
 * and some spans are then missing.
 */
import { type ScriptedReply, type ScriptedRequest, startScriptedServer } from "./http.ts";

/** A signal of OpenTelemetry that the collector reads. */
export type OtlpSignal = "traces" | "metrics" | "logs";

/** These are the signals of the collector, with the paths `/v1/traces`, `/v1/metrics` and `/v1/logs`. */
export const OTLP_SIGNALS: readonly OtlpSignal[] = ["traces", "metrics", "logs"];

/** The options of `waitFor`. */
export interface OtlpWaitOptions {
  /** The signal. The default is `traces`. */
  readonly signal?: OtlpSignal;
  /** The longest wait in ms. The default is 20000. */
  readonly timeoutMs?: number;
  /** The time in ms between two reads. The default is 500. */
  readonly intervalMs?: number;
  /** A call before each read, for example a request to the service. A poke that rejects does not stop the wait, because the service can still start. */
  readonly poke?: () => Promise<unknown>;
}

/** A stand-in OTLP/HTTP collector that listens. */
export interface OtlpCollector {
  /** The value of `OTEL_EXPORTER_OTLP_ENDPOINT`, for example `http://127.0.0.1:43211`. The exporters add the path of the signal. */
  readonly endpoint: string;
  /** This method gives the count of the exports of a signal, read or not. The default signal is `traces`. */
  exports(signal?: OtlpSignal): number;
  /** This method gives the count of the exports of a signal that are not OTLP JSON, for example protobuf or gzip. The collector cannot read them. */
  unread(signal?: OtlpSignal): number;
  /** This method gives the count of the items of each scope: the spans, the metrics or the log records. */
  counts(signal?: OtlpSignal): ReadonlyMap<string, number>;
  /**
   * This method gives the names of each scope. These are the names of the spans or the metrics, or the event names of the log records.
   * An item with no name has a count and no name.
   */
  names(signal?: OtlpSignal): ReadonlyMap<string, ReadonlySet<string>>;
  /** This method gives the scopes of a list that have no item of the signal. */
  missing(scopes: readonly string[], signal?: OtlpSignal): string[];
  /** This method waits until each scope has an item of the signal, `timeoutMs` at most. It gives the scopes that are still missing. */
  waitFor(scopes: readonly string[], options?: OtlpWaitOptions): Promise<string[]>;
  /** This method stops the collector and destroys each open connection. */
  close(): Promise<void>;
}

const PATHS: Readonly<Record<OtlpSignal, string>> = { traces: "/v1/traces", metrics: "/v1/metrics", logs: "/v1/logs" };
const KEYS: Readonly<Record<OtlpSignal, readonly [resources: string, scopes: string, items: string, name: string]>> = {
  traces: ["resourceSpans", "scopeSpans", "spans", "name"],
  metrics: ["resourceMetrics", "scopeMetrics", "metrics", "name"],
  logs: ["resourceLogs", "scopeLogs", "logRecords", "eventName"],
};
const REPLY: ScriptedReply = { status: 200, fields: { "content-type": "application/json" }, body: "{}" };

interface SignalState {
  exports: number;
  unread: number;
  readonly counts: Map<string, number>;
  readonly names: Map<string, Set<string>>;
}

const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const field = (value: unknown, key: string): unknown => (typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined);

/** This function tells if the collector can read the body of a request: OTLP JSON with no content encoding. */
function readable(request: ScriptedRequest): boolean {
  const type = (request.fields["content-type"] ?? "").toLowerCase();
  const encoding = (request.fields["content-encoding"] ?? "identity").toLowerCase();
  return type.startsWith("application/json") && encoding === "identity";
}

/** This function adds the items of one export to the state of its signal. It gives false for a body that is not an object of JSON. */
function addExport(state: SignalState, signal: OtlpSignal, body: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
  const [resources, scopes, items, nameKey] = KEYS[signal];
  for (const resource of listOf(field(parsed, resources))) {
    for (const scoped of listOf(field(resource, scopes))) {
      const scopeName = field(field(scoped, "scope"), "name");
      const scope = typeof scopeName === "string" ? scopeName : "";
      const names = state.names.get(scope) ?? new Set<string>();
      for (const item of listOf(field(scoped, items))) {
        state.counts.set(scope, (state.counts.get(scope) ?? 0) + 1);
        const name = field(item, nameKey);
        if (typeof name === "string" && name !== "") names.add(name);
      }
      if (state.counts.has(scope)) state.names.set(scope, names);
    }
  }
  return true;
}

const checkSignal = (signal: unknown): OtlpSignal => {
  if (!OTLP_SIGNALS.includes(signal as OtlpSignal)) throw new RangeError(`otlp: the signal is one of ${OTLP_SIGNALS.join(", ")}, not ${String(signal)}.`);
  return signal as OtlpSignal;
};

/** This function starts a stand-in OTLP/HTTP collector on a free port of 127.0.0.1. It replies 200 with `{}` to each export. */
export async function startOtlpCollector(): Promise<OtlpCollector> {
  const server = await startScriptedServer({ routes: OTLP_SIGNALS.map((signal) => ({ method: "POST", path: PATHS[signal], replies: [REPLY] })) });
  const states = new Map<OtlpSignal, SignalState>(OTLP_SIGNALS.map((signal) => [signal, { exports: 0, unread: 0, counts: new Map(), names: new Map() }]));
  let read = 0;
  const stateOf = (signal: OtlpSignal = "traces"): SignalState => {
    const checked = checkSignal(signal);
    for (; read < server.requests.length; read += 1) {
      const request = server.requests[read]!;
      const of = OTLP_SIGNALS[request.route];
      if (of === undefined) continue;
      const state = states.get(of)!;
      state.exports += 1;
      if (!readable(request) || !addExport(state, of, request.body)) state.unread += 1;
    }
    return states.get(checked)!;
  };
  const missing = (scopes: readonly string[], signal?: OtlpSignal): string[] => {
    const counts = stateOf(signal).counts;
    return scopes.filter((scope) => (counts.get(scope) ?? 0) === 0);
  };
  return {
    endpoint: server.url,
    exports: (signal) => stateOf(signal).exports,
    unread: (signal) => stateOf(signal).unread,
    counts: (signal) => new Map(stateOf(signal).counts),
    names: (signal) => new Map([...stateOf(signal).names].map(([scope, names]) => [scope, new Set(names)])),
    missing,
    async waitFor(scopes, options = {}) {
      const timeoutMs = options.timeoutMs ?? 20_000;
      const intervalMs = options.intervalMs ?? 500;
      if (!(Number.isFinite(timeoutMs) && timeoutMs >= 0)) throw new RangeError(`otlp: timeoutMs is a finite number of 0 or more, not ${String(timeoutMs)}.`);
      if (!(Number.isFinite(intervalMs) && intervalMs > 0)) throw new RangeError(`otlp: intervalMs is a finite number above 0, not ${String(intervalMs)}.`);
      const signal = checkSignal(options.signal ?? "traces");
      const until = Date.now() + timeoutMs;
      for (;;) {
        await options.poke?.().catch(() => undefined);
        const left = missing(scopes, signal);
        const remaining = until - Date.now();
        if (left.length === 0 || remaining <= 0) return left;
        await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
      }
    },
    close: () => server.close(),
  };
}
