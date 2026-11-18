import { defineConfig } from "tsdown";

// The build for npm: ES modules in build/, with types. The workspace runs the source (main is src/index.ts).
// The root entry reads and writes files, so it runs in Node. The entry propagation uses the OpenTelemetry API only.
// The entries model, metamorphic and arbitrary use fast-check (an optional peer dependency), so the root entry does not load it.
// The entry otel uses the OpenTelemetry SDK (optional peer dependencies), so the other entries do not load it.
// The entry http is a scripted HTTP server on node:http, with no dependency. Its WebSocket routes load the frame codec of
// rigor-proxy (an optional peer dependency) only when a script has them. The entry otlp is a stand-in collector on it.
// The entry fakes has test fakes of browser objects, with no dependency.
// The entry child starts a server of a test in a child process on node:child_process, with no dependency.
// The entry stop runs a program of a test to a stop of a plan of rigor-chaos (an optional peer dependency), so the
// other entries do not load it.
// The entry stop-point is the child side of the entry stop. It imports only node: modules, so a copy of its built
// file works with no packages. The hook build:done stops the build when that file imports another module.
// The entry behavior compares two functions on the draws of rigor-generators (an optional peer dependency), so the
// other entries do not load it.
// The entry xmpp is a scripted XMPP server on node:net and node:tls. It reads the XML of the client with ltx (an
// optional peer dependency), so the other entries do not load it. The entry tls makes the certificates of a TLS server
// of a test with node:crypto, and it has no peer. The entry process-starts counts the starts of node:child_process, and
// the entry git-fixture makes the git repositories of a test with few git starts. They have no dependency.
export default defineConfig({
  entry: ["src/index.ts", "src/model.ts", "src/metamorphic.ts", "src/arbitrary.ts", "src/propagation.ts", "src/otel.ts", "src/http.ts", "src/otlp.ts", "src/fakes.ts", "src/child.ts", "src/stop.ts", "src/stop-point.ts", "src/behavior.ts", "src/xmpp.ts", "src/tls.ts", "src/process-starts.ts", "src/git-fixture.ts"],
  outDir: "build",
  format: "esm",
  platform: "node",
  fixedExtension: false,
  sourcemap: true,
  dts: true,
  unbundle: true,
  publint: true,
  hooks: {
    "build:done": ({ chunks }) => {
      const point = chunks.find((chunk) => chunk.type === "chunk" && chunk.fileName === "stop-point.js");
      if (point === undefined || point.type !== "chunk") throw new Error("The build has no file stop-point.js.");
      const imports = [...point.imports, ...point.dynamicImports];
      // The file imports node:fs and node:os. A list with no import shows that the check did not read the file.
      if (imports.length === 0) throw new Error("The build gives no imports for stop-point.js, so the check cannot read it.");
      const others = imports.filter((name) => !name.startsWith("node:"));
      if (others.length > 0) throw new Error(`stop-point.js imports ${others.join(", ")}. It imports only node: modules, so a copy works with no packages.`);
    },
  },
});
