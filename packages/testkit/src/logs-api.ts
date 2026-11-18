/**
 * The logs APIs of OpenTelemetry. From version 1.10, `@opentelemetry/api` has its own logs API, and the SDK 3 uses
 * it. The SDK 2 uses `@opentelemetry/api-logs`. Each API has its own global logger provider. Thus the capture sets its
 * provider in each API of the program, and the propagation gate writes through each API that has a provider.
 *
 * The API of `@opentelemetry/api-logs` is a bridge for the programs on the SDK 2. It is an optional peer, and the
 * module loads it only when the program installs it. The bridge ends when no user of the kit is on the SDK 2.
 *
 * @internal
 */
import { createRequire } from "node:module";
import { logs, type LogRecord } from "@opentelemetry/api";
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

/** The name of the package of the logs API of the SDK 2 */
const SDK_2_LOGS_PACKAGE = "@opentelemetry/api-logs";

/**
 * This function gives the logs APIs: the API of `@opentelemetry/api`, then the API of `@opentelemetry/api-logs` when
 * `load` finds the package. A package that is not there gives only the first API. Any other error of `load` goes to
 * the caller.
 */
export function logsApis(load: (id: string) => unknown = createRequire(import.meta.url)): readonly LogsApi[] {
  try {
    return [logs, (load(SDK_2_LOGS_PACKAGE) as { readonly logs: LogsApi }).logs];
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === "MODULE_NOT_FOUND") return [logs];
    throw error;
  }
}

/** The logs APIs of the program: the API of `@opentelemetry/api`, then the API of `@opentelemetry/api-logs` if it is installed */
export const LOGS_APIS: readonly LogsApi[] = logsApis();

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
