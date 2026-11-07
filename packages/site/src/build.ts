/**
 * node src/build.ts [--out dist]
 *
 * The build of the site: it bundles src/page.ts (with the generators and the bench) for the browser, and writes index.html.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NOISE_RANGE, RATIO_RANGE, START } from "./explorer.ts";

/** The packages of rigor: the name, the state and what each one gives. */
export interface PackageRow {
  readonly name: string;
  readonly state: string;
  readonly gives: string;
}

/** The versions of the built packages. A package with no version here is planned. */
export interface Versions {
  readonly generators: string;
  readonly statistics: string;
  readonly bench: string;
  readonly chaos: string;
  readonly mutation: string;
}

export function packageRows(versions: Versions): PackageRow[] {
  return [
    { name: "@mark1russell7/rigor-generators", state: versions.generators, gives: "A seeded generator and its draws: integers, picks, weights, shuffles, samples, normal values and named streams. Next: input families, stratified and Latin hypercube designs, Saltelli designs, shrinking." },
    { name: "@mark1russell7/rigor-statistics", state: versions.statistics, gives: "Quantiles, bootstrap intervals (also of clusters), the sign test, the paired permutation test, Wilson intervals, the Holm correction, rank correlation, the comparison with a baseline beyond the noise (the 5-seed rule), and Brier scores. Next: Sobol indices." },
    { name: "@mark1russell7/rigor-bench", state: versions.bench, gives: "The paired-time records of a bench: the order that turns each round, the ratio of each case, and the time verdict against the band of an A/A arm. Next: a fresh process for each case, the CPU model, speed gates." },
    { name: "rigor-gates", state: "planned", gives: "The determinism gate (one input gives one hash), the promotion test and the performance evidence of a release." },
    { name: "rigor-testgen", state: "planned", gives: "Property tests on fast-check, pairwise and covering arrays, and metamorphic relations." },
    { name: "@mark1russell7/rigor-chaos", state: versions.chaos, gives: "Open-loop load schedules from a rate profile, and a measure of latency from the planned time, with no coordinated omission. Next: fault injection, schedules of latency and failure." },
    { name: "@mark1russell7/rigor-mutation", state: versions.mutation, gives: "Mutation tests with Stryker for each package: the Stryker config of each package or part, a score with a gate for each package, and a check of the disabled mutants." },
  ];
}

/** This function reads the shared cue of a box that scrolls sideways, `scroll-cue.css` of `@mark1russell7/site-pages`. */
export function scrollCueCss(): string {
  return readFileSync(fileURLToPath(import.meta.resolve("@mark1russell7/site-pages/scroll-cue.css")), "utf8");
}

const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The section of the time-verdict explorer. The script of the page fills the presets, the rounds, the verdict and the diagram. */
export function verdictSection(): string {
  const range = (id: string, r: { min: number; max: number; step: number }, value: number): string =>
    `<input type="range" id="${id}" min="${r.min}" max="${r.max}" step="${r.step}" value="${value}">`;
  return `<section id="verdict">
<h2>Try the time verdict</h2>
<p>A bench times a baseline and a candidate in pairs. An A/A pair times the baseline against itself, so it shows the noise of the machine. Set the true ratio and the noise. The page draws seeded records, and <code>timeVerdict</code> of <code>rigor-bench</code> gives the verdict.</p>
<div class="card">
<div class="field"><span class="field-label">Presets</span><div id="vx-presets" class="chips" role="group" aria-label="Presets"></div></div>
<div class="controls">
<label>True ratio: candidate time over baseline time <output id="vx-ratio-out"></output>${range("vx-ratio", RATIO_RANGE, START.ratio)}</label>
<label>Noise of one arm in one round <output id="vx-noise-out"></output>${range("vx-noise", NOISE_RANGE, START.noise)}</label>
<div class="field"><span class="field-label">Rounds of each case</span><div id="vx-rounds" class="chips" role="group" aria-label="Rounds of each case"></div></div>
<label>Seed<input id="vx-seed" value="${escape(START.seed)}" autocomplete="off" spellcheck="false"></label>
</div>
<div class="verdict" aria-live="polite"><span id="vx-badge" class="badge"></span><p id="vx-why"></p></div>
<div id="vx-chart"></div>
<div class="legend"><span><span class="key dot"></span>candidate case</span><span><span class="key dot aa"></span>A/A case</span><span><span class="key dot faint"></span>one round</span><span><span class="key zone"></span>same zone</span><span><span class="key band"></span>pooled A/A band</span><span><span class="key interval"></span>interval of the candidate</span><span><span class="key truth"></span>true ratio</span></div>
<p id="vx-facts" class="fine"></p>
<p id="vx-reason" class="fine"></p>
<div class="power"><button type="button" id="vx-power-run">Test the rule on 50 new benches</button><div id="vx-power"></div></div>
<details id="vx-records"><summary>The paired-time records (<span id="vx-record-count"></span>)</summary>
<div class="records scroll-cue"><table><thead><tr><th>Case</th><th>Round</th><th>First</th><th>a (ms)</th><th>b (ms)</th><th>b / a</th></tr></thead><tbody id="vx-record-rows"></tbody></table></div>
</details>
<pre class="scroll-cue"><code id="vx-code"></code></pre>
</div>
</section>`;
}

export function pageHtml(rows: readonly PackageRow[], built: string, scrollCue = ""): string {
  const table = rows
    .map((r) => `<tr><td><code>${escape(r.name)}</code></td><td><span class="state${r.state === "planned" ? " later" : ""}">${escape(r.state)}</span></td><td>${escape(r.gives)}</td></tr>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rigor</title>
<meta name="description" content="Shared libraries for measured work: seeded generators, statistics, gates, test generation, chaos and load.">
<style>
${scrollCue}
:root { color-scheme: light dark; --bg: #fcfcfb; --card: #ffffff; --ink: #1d1d1b; --muted: #5f5e5a; --line: #e4e2dc; --accent: #2a78d6; --accent-soft: #e6f0fc; --expected: #1d1d1b; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #1a1a19; --card: #232321; --ink: #ecebe6; --muted: #a5a39b; --line: #3a3936; --accent: #3987e5; --accent-soft: #1f3550; --expected: #ecebe6; } }
:root[data-theme="dark"] { --bg: #1a1a19; --card: #232321; --ink: #ecebe6; --muted: #a5a39b; --line: #3a3936; --accent: #3987e5; --accent-soft: #1f3550; --expected: #ecebe6; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
header, main, footer { max-width: 960px; margin: 0 auto; padding: 0 16px; }
header { padding-top: 40px; }
h1 { font-size: 2.4rem; margin: 0; letter-spacing: -0.02em; }
.lead { font-size: 1.15rem; color: var(--muted); margin: 8px 0 16px; max-width: 46em; }
nav { display: flex; flex-wrap: wrap; gap: 6px 18px; padding: 10px 0 18px; border-bottom: 1px solid var(--line); }
nav a { color: var(--accent); text-decoration: none; font-weight: 600; }
nav a:hover { text-decoration: underline; }
section { padding: 28px 0 8px; }
h2 { font-size: 1.35rem; margin: 0 0 6px; }
p { max-width: 46em; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 18px; }
.controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 12px; margin-bottom: 12px; }
label { display: block; font-size: 0.85rem; color: var(--muted); font-weight: 600; }
input { width: 100%; font: inherit; padding: 8px 10px; margin-top: 4px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink); }
#methods, .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 14px; }
#methods button, .chips button, .power button { font: inherit; font-size: 0.9rem; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); cursor: pointer; }
#methods button[aria-pressed="true"], .chips button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.chips { margin: 4px 0 0; }
.field { margin-bottom: 12px; }
.field-label { display: block; font-size: 0.85rem; color: var(--muted); font-weight: 600; }
output { color: var(--ink); font-variant-numeric: tabular-nums; }
input[type="range"] { padding: 0; margin-top: 10px; border: 0; background: none; accent-color: var(--accent); }
.verdict { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; margin: 4px 0 12px; }
.verdict p { margin: 0; flex: 1 1 16em; font-weight: 600; }
.badge { font-size: 1.5rem; font-weight: 700; padding: 6px 18px; border-radius: 999px; white-space: nowrap; background: var(--line); color: var(--ink); }
.badge[data-outcome="faster"] { background: #0ca30c; color: #fff; }
.badge[data-outcome="slower"] { background: #d03b3b; color: #fff; }
.badge[data-outcome="same"] { background: var(--accent-soft); color: var(--ink); }
.badge[data-outcome="cannot decide"] { background: #fab219; color: #0b0b0b; }
#vx-chart svg { display: block; }
.rec { fill-opacity: 0.45; stroke-width: 1; }
.rec.s-candidate { stroke: var(--accent); }
.rec.s-aa { stroke: var(--muted); }
.s-candidate { fill: var(--accent); }
.s-aa { fill: var(--muted); }
.case { stroke: var(--card); stroke-width: 2; }
.case.on { stroke: var(--ink); }
.grid { stroke: var(--line); }
.zone { fill: var(--muted); opacity: 0.25; }
.band { fill: none; stroke: var(--ink); stroke-width: 1; stroke-dasharray: 4 3; opacity: 0.6; }
.one { stroke: var(--ink); stroke-width: 1.5; }
.truth, .interval { fill: var(--ink); }
.interval.on { fill: var(--accent); }
.estimate { fill: var(--ink); stroke: var(--card); stroke-width: 2; }
.row-label { fill: var(--muted); font-size: 12px; }
.key.dot { width: 10px; height: 10px; border-radius: 50%; }
.key.dot.aa { background: var(--muted); }
.key.dot.faint { width: 8px; height: 8px; border: 1px solid var(--accent); background: color-mix(in srgb, var(--accent) 45%, transparent); }
.key.zone { background: var(--muted); opacity: 0.4; }
.key.band { background: none; border: 1px dashed var(--ink); }
.key.interval { background: var(--ink); height: 6px; border-radius: 3px; }
.key.truth { width: 0; height: 0; border-radius: 0; background: none; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 8px solid var(--ink); }
.fine { font-size: 0.88rem; color: var(--muted); margin: 8px 0 0; }
.power { margin: 14px 0 10px; }
.power button:disabled { opacity: 0.6; cursor: progress; }
#vx-power p { margin: 8px 0 4px; }
.shares { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0; padding: 0; list-style: none; font-size: 0.9rem; }
.shares .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; background: var(--line); }
.shares [data-outcome="faster"] .swatch { background: #0ca30c; }
.shares [data-outcome="slower"] .swatch { background: #d03b3b; }
.shares [data-outcome="same"] .swatch { background: var(--accent); }
.shares [data-outcome="cannot decide"] .swatch { background: #fab219; }
details { margin: 10px 0 12px; }
summary { cursor: pointer; font-weight: 600; }
.records { max-height: 320px; overflow-y: auto; margin-top: 8px; border: 1px solid var(--line); border-radius: 8px; }
.records table { font-size: 0.85rem; font-variant-numeric: tabular-nums; }
.records th, .records td { padding: 4px 8px; white-space: nowrap; }
.scroll-cue { --scroll-cue-bg: var(--bg); }
.records.scroll-cue { --scroll-cue-bg: var(--card); }
pre { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; overflow-x: auto; font-size: 0.9rem; margin: 0 0 12px; }
code { font-family: ui-monospace, "Cascadia Code", Menlo, monospace; font-size: 0.92em; }
.split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2.4fr); gap: 16px; }
@media (max-width: 640px) { .split { grid-template-columns: 1fr; } }
#values { margin: 0; padding: 0; list-style: none; font-family: ui-monospace, Menlo, monospace; font-size: 0.9rem; columns: 2; }
#values li { padding: 1px 0; }
#chart svg { width: 100%; height: auto; display: block; }
.bar { fill: var(--accent); }
.bar.on { fill: var(--ink); }
.hit { fill: transparent; }
.expected { fill: none; stroke: var(--expected); stroke-width: 2; stroke-dasharray: 5 4; }
.axis { stroke: var(--line); }
.tick { fill: var(--muted); font-size: 12px; }
.legend { display: flex; gap: 16px; font-size: 0.85rem; color: var(--muted); margin-top: 6px; flex-wrap: wrap; }
.key { display: inline-block; width: 14px; height: 10px; border-radius: 2px; background: var(--accent); vertical-align: middle; margin-right: 6px; }
.key.line { background: none; border-top: 2px dashed var(--expected); height: 0; }
#stats { font-size: 0.9rem; color: var(--muted); margin: 8px 0 0; }
#tip { position: fixed; z-index: 2; pointer-events: none; background: var(--ink); color: var(--bg); font-size: 0.85rem; padding: 4px 8px; border-radius: 6px; }
.table { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.95rem; }
th, td { text-align: left; vertical-align: top; padding: 10px 8px; border-bottom: 1px solid var(--line); }
th { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
@media (max-width: 640px) {
  thead { display: none; }
  table, tbody, tr, td { display: block; width: 100%; }
  tr { padding: 10px 0; border-bottom: 1px solid var(--line); }
  td { border: 0; padding: 2px 0; }
  td:first-child code { font-weight: 700; }
}
.state { display: inline-block; padding: 1px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--ink); font-size: 0.85rem; white-space: nowrap; }
.state.later { background: transparent; border: 1px solid var(--line); color: var(--muted); }
footer { color: var(--muted); font-size: 0.85rem; padding-top: 24px; padding-bottom: 40px; }
footer a, p a { color: var(--accent); }
</style>
</head>
<body>
<header>
<h1>rigor</h1>
<p class="lead">Shared libraries for measured work: seeded generators, statistics, gates, test generation, chaos and load. Each engine moves to them one function at a time, and its records stay byte-equal.</p>
<nav><a href="#try">Try the generator</a><a href="#verdict">Try the time verdict</a><a href="#packages">Packages</a><a href="#why">Why</a><a href="status/">Status</a><a href="releases/">Releases</a><a href="https://github.com/mark1russell7/rigor">Source</a></nav>
</header>
<main>
<section id="try">
<h2>Try the generator</h2>
<p>The same seed gives the same numbers each time, in Node and in each browser. Type a seed, or a label for a named stream, and the page draws again.</p>
<div class="card">
<div class="controls">
<label>Seed (an integer or any text)<input id="seed" value="42" autocomplete="off" spellcheck="false"></label>
<label>Stream label (optional, for <code>fork</code>)<input id="label" value="" placeholder="for example lanes" autocomplete="off" spellcheck="false"></label>
</div>
<div id="methods" role="group" aria-label="The method"></div>
<pre class="scroll-cue"><code id="code"></code></pre>
<div class="split">
<div><label>The first 12 values</label><ol id="values"></ol></div>
<div><label>20,000 draws</label><div id="chart"></div>
<div class="legend"><span><span class="key"></span>draws in each bin</span><span><span class="key line"></span>expected count</span></div>
<p id="stats"></p></div>
</div>
</div>
</section>
${verdictSection()}
<section id="packages">
<h2>Packages</h2>
<div class="table scroll-cue"><table>
<thead><tr><th>Package</th><th>State</th><th>What it gives</th></tr></thead>
<tbody>
${table}
</tbody></table></div>
</section>
<section id="why">
<h2>Why</h2>
<p>The duplication atlas (<a href="https://mark1russell7.github.io/codeatlas/">codeatlas</a>) found the same seeded generator written by hand approximately 40 times, in more than 10 repositories. No repository imported it from a package. The copies use different forms of mulberry32, but each one gives the same numbers as <code>random(seed).next</code>. Thus a repository moves to the package with no change to its records, and its tests prove it.</p>
<pre class="scroll-cue"><code>npm install @mark1russell7/rigor-generators

import { random, seedsFrom } from "@mark1russell7/rigor-generators";

for (const seed of seedsFrom(process.env.SEED, [1, 2, 3, 4, 5])) {
  const r = random(seed);
  const lanes = r.fork("lanes");       // an independent stream for one part of the work
  const n = r.int(10, 1000);           // 10 to 1000, both included
  const order = lanes.shuffle(items);  // a new list in a random order
}</code></pre>
</section>
</main>
<footer>Built ${escape(built)}. MIT license. <a href="https://github.com/mark1russell7/rigor">github.com/mark1russell7/rigor</a></footer>
<div id="tip" hidden></div>
<script type="module" src="page.js"></script>
</body>
</html>
`;
}

/**
 * This function gives the module names that a bundle still imports. The page bundle runs in a browser, so it imports none.
 * A browser cannot load a Node module (for example `node:fs`). Then no script of the page starts.
 * The bundler puts each static import at the start of an ES module, so this function reads only the statements at the start.
 * Thus the text of a code example in a string is not an import.
 */
export function bundleImports(code: string): string[] {
  const statement = /^\s*(?:import|export)\s*(?:[\w$*{},\s]*?\bfrom\s*)?["']([^"']+)["']\s*;?/;
  const names: string[] = [];
  let rest = code;
  for (let m = statement.exec(rest); m !== null; m = statement.exec(rest)) {
    names.push(m[1]!);
    rest = rest.slice(m[0].length);
  }
  return names;
}

export function parseSiteArgs(argv: readonly string[]): { readonly out: string } | { readonly error: string } {
  let out = "dist";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      const v = argv[++i];
      if (v === undefined) return { error: "--out takes a folder." };
      out = v;
    } else return { error: `Unknown argument: ${argv[i]}` };
  }
  return { out };
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseSiteArgs(argv);
  if ("error" in args) {
    console.error(args.error);
    return 2;
  }
  const here = fileURLToPath(new URL("..", import.meta.url));
  const out = join(here, args.out);
  mkdirSync(out, { recursive: true });
  const { build } = await import("tsdown");
  await build({
    config: false,
    entry: { page: join(here, "src/page.ts") },
    outDir: out,
    format: "esm",
    platform: "browser",
    fixedExtension: false,
    noExternal: [/.*/],
    dts: false,
    minify: true,
    clean: false,
  });
  const left = bundleImports(readFileSync(join(out, "page.js"), "utf8"));
  if (left.length > 0) {
    console.error(`page.js imports ${left.join(", ")}, and a browser cannot load it. The bundle holds each module of the page.`);
    return 1;
  }
  const version = (name: string): string => (JSON.parse(readFileSync(join(here, `../${name}/package.json`), "utf8")) as { version: string }).version;
  const rows = packageRows({ generators: version("generators"), statistics: version("statistics"), bench: version("bench"), chaos: version("chaos"), mutation: version("mutation") });
  writeFileSync(join(out, "index.html"), pageHtml(rows, new Date().toISOString().slice(0, 10), scrollCueCss()));
  console.error(`wrote ${join(out, "index.html")} and page.js`);
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
