import { defineConfig } from "tsdown";

// The build for npm: ES modules in build/, with types. The workspace runs the source (main is src/index.ts).
// The library has no Node imports, so it runs in Node and in a browser.
export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "build",
  format: "esm",
  platform: "neutral",
  fixedExtension: false,
  sourcemap: true,
  dts: true,
  publint: true,
});
