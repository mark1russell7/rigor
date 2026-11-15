/**
 * The two logs APIs of OpenTelemetry. From version 1.10, `@opentelemetry/api` has its own logs API, and the SDK 3
 * uses it. The SDK 2 and older programs use `@opentelemetry/api-logs`. Each API has its own global logger provider.
 * Thus the capture sets its provider in each API, and the propagation gate writes through the API that has a provider.
 *
 * @internal
 */
import * as api from "@opentelemetry/api";
import { logs as apiLogsPackage, type LogRecord } from "@opentelemetry/api-logs";
import type { LoggerProvider } from "@opentelemetry/sdk-logs";

/** The part of a logs API that the capture and the gate use */
export interface LogsApi {
  setGlobalLoggerProvider(provider: LoggerProvider): unknown;
  getLoggerProvider(): object;
  disable(): void;
}

/** A logger provider of a program: it gives loggers that write log records */
interface WritingProvider {
  getLogger(name: string): { emit(record: LogRecord): void };
}

/** The logs API of `@opentelemetry/api`. A version before 1.10 has none. */
const fromApi = (api as { readonly logs?: LogsApi }).logs;

/** The logs APIs: the API of `@opentelemetry/api` when it has one, then the API of `@opentelemetry/api-logs`. */
export const LOGS_APIS: readonly LogsApi[] = fromApi === undefined ? [apiLogsPackage] : [fromApi, apiLogsPackage];

/**
 * This function gives the providers that a program set in the logs APIs, each one time. An API with no provider
 * gives its own proxy provider (it has `_getDelegate` in each version), and the function does not give it.
 */
export function registeredLoggerProviders(): object[] {
  const providers: object[] = [];
  for (const logsApi of LOGS_APIS) {
    const provider = logsApi.getLoggerProvider();
    if (!("_getDelegate" in provider) && !providers.includes(provider)) providers.push(provider);
  }
  return providers;
}

/**
 * This function gives a logger that writes each record one time to each provider that a program set. With no
 * provider, the logger writes nothing.
 */
export function globalLogger(name: string): { emit(record: LogRecord): void } {
  return {
    emit(record) {
      for (const provider of registeredLoggerProviders()) (provider as WritingProvider).getLogger(name).emit(record);
    },
  };
}
