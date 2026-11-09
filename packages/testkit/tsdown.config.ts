import { defineConfig } from "tsdown";

// The build for npm: ES modules in build/, with types. The workspace runs the source (main is src/index.ts).
// The root entry reads and writes files, so it runs in Node. The entry propagation uses the OpenTelemetry API only.
export default defineConfig({
  entry: ["src/index.ts", "src/model.ts", "src/propagation.ts"],
  outDir: "build",
  format: "esm",
  platform: "node",
  fixedExtension: false,
  sourcemap: true,
  dts: true,
  unbundle: true,
  publint: true,
});
