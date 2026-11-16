import { defineConfig } from "tsdown";

// The build for npm: ES modules in build/, with types. The workspace runs the source (main is src/index.ts).
// The root entry reads and writes files, so it runs in Node. The entry propagation uses the OpenTelemetry API only.
// The entries model and arbitrary use fast-check (an optional peer dependency), so the root entry does not load it.
// The entry otel uses the OpenTelemetry SDK (optional peer dependencies), so the other entries do not load it.
// The entry http is a scripted HTTP server on node:http, with no dependency. The entry otlp is a stand-in collector on it.
// The entry fakes has test fakes of browser objects, with no dependency.
// The entry child starts a server of a test in a child process on node:child_process, with no dependency.
// The entry stop runs a program of a test to a stop of a plan of rigor-chaos (an optional peer dependency), so the
// other entries do not load it.
export default defineConfig({
  entry: ["src/index.ts", "src/model.ts", "src/arbitrary.ts", "src/propagation.ts", "src/otel.ts", "src/http.ts", "src/otlp.ts", "src/fakes.ts", "src/child.ts", "src/stop.ts"],
  outDir: "build",
  format: "esm",
  platform: "node",
  fixedExtension: false,
  sourcemap: true,
  dts: true,
  unbundle: true,
  publint: true,
});
