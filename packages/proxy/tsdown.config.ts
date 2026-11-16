import { defineConfig } from "tsdown";

// The build for npm: ES modules in build/, with types. The workspace runs the source (main is src/index.ts).
// The proxy uses node:net, so it runs in Node. The entry applier imports no module of Node.js, so a browser can load it.
export default defineConfig({
  entry: ["src/index.ts", "src/applier-entry.ts"],
  outDir: "build",
  format: "esm",
  platform: "node",
  fixedExtension: false,
  sourcemap: true,
  dts: true,
  // One output file for each source file: with `sideEffects: false`, a bundler drops each file that a user does not import.
  unbundle: true,
  publint: true,
});
