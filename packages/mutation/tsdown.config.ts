import { defineConfig } from "tsdown";

// The build for npm: ES modules in build/. index.js is the library with its types, and cli.js is the
// bin with the shebang of the source. reporter.js is the Stryker reporter that the config names by its file URL.
// collect.js is the script that load-check --collect starts in a new process.
// The workspace runs the source (main is src/index.ts).
export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts", "src/reporter.ts", "src/collect.ts"],
  outDir: "build",
  format: "esm",
  platform: "node",
  fixedExtension: false,
  sourcemap: true,
  dts: true,
  publint: true,
});
