import { defineConfig } from "tsdown";

// The build for npm: ES modules in build/, with types. The workspace runs the source (main is src/index.ts).
// The root entry has no Node imports other than node:perf_hooks. The entry fresh starts child processes, so it is for Node only.
export default defineConfig({
  entry: ["src/index.ts", "src/fresh.ts"],
  outDir: "build",
  format: "esm",
  platform: "neutral",
  fixedExtension: false,
  // The shared chunk of the two entries gets a fixed name, so the API report does not change with each build.
  hash: false,
  sourcemap: true,
  dts: true,
  publint: true,
});
