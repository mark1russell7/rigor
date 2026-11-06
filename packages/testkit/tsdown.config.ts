import { defineConfig } from "tsdown";

// The build for npm: ES modules in build/, with types. The workspace runs the source (main is src/index.ts).
// The package reads and writes files, so it runs in Node.
export default defineConfig({
  entry: ["src/index.ts", "src/model.ts"],
  outDir: "build",
  format: "esm",
  platform: "node",
  fixedExtension: false,
  sourcemap: true,
  dts: true,
  unbundle: true,
  publint: true,
});
