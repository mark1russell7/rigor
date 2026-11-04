// The draws of this package must not bring the recorded tables into a bundle. Each table has license text and 100 numbers.
// This test makes the real build, with the real value of `sideEffects`, then bundles a small user of it.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";
import { build } from "tsdown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** The text that only the tables have. */
const TABLE_TEXT = "Ptolemy";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
let outDir = "";

/** This function bundles a user that imports `names`, and gives the output as text. */
async function bundleOf(names: string): Promise<string> {
  const contents = `import { ${names} } from "./index.js";\nconsole.log(${names});\n`;
  const result = await bundle({
    stdin: { contents, resolveDir: outDir },
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles.map((file) => file.text).join("");
}

describe("the bundle of a user of this package", () => {
  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "generators-tree-shake-"));
    const { sideEffects } = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as { sideEffects?: boolean };
    await build({ config: join(packageDir, "tsdown.config.ts"), cwd: packageDir, outDir, dts: false, publint: false, logLevel: "silent" });
    writeFileSync(join(outDir, "package.json"), JSON.stringify({ type: "module", sideEffects }));
  }, 60_000);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it.each(["fnv1a32, random, mulberry32", "fnv1a32, mulberry32", "sampler", "seedOf, deriveSeed"])("%s holds no table", async (names) => {
    expect(await bundleOf(names)).not.toContain(TABLE_TEXT);
  });

  it("holds a table when the user imports it", async () => {
    expect(await bundleOf("DIAGRAM_BOX_AREA")).toContain(TABLE_TEXT);
  });
});
