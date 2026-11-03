/**
 * node src/build.ts [--out dist]
 *
 * The build of the site: it bundles src/page.ts (with the generators) for the browser, and writes index.html.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
}

export function packageRows(versions: Versions): PackageRow[] {
  return [
    { name: "@mark1russell7/rigor-generators", state: versions.generators, gives: "A seeded generator and its draws: integers, picks, weights, shuffles, samples, normal values and named streams. Next: input families, stratified and Latin hypercube designs, Saltelli designs, shrinking." },
    { name: "@mark1russell7/rigor-statistics", state: versions.statistics, gives: "Quantiles, bootstrap intervals (also of clusters), the sign test, the paired permutation test, Wilson intervals, the Holm correction, rank correlation, the comparison with a baseline beyond the noise (the 5-seed rule), and Brier scores. Next: Sobol indices." },
    { name: "@mark1russell7/rigor-bench", state: versions.bench, gives: "The paired-time records of a bench: the order that turns each round, the ratio of each case, and the time verdict against the band of an A/A arm. Next: a fresh process for each case, the CPU model, speed gates." },
    { name: "rigor-gates", state: "planned", gives: "The determinism gate (one input gives one hash), the promotion test and the performance evidence of a release." },
    { name: "rigor-testgen", state: "planned", gives: "Property tests on fast-check, pairwise and covering arrays, and metamorphic relations." },
    { name: "rigor-chaos", state: "planned", gives: "Fault injection, schedules of latency and failure, and load profiles, with their measures." },
  ];
}

const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function pageHtml(rows: readonly PackageRow[], built: string): string {
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
#methods { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 14px; }
#methods button { font: inherit; font-size: 0.9rem; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); cursor: pointer; }
#methods button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
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
<nav><a href="#try">Try it</a><a href="#packages">Packages</a><a href="#why">Why</a><a href="status/">Status</a><a href="releases/">Releases</a><a href="https://github.com/mark1russell7/rigor">Source</a></nav>
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
<pre><code id="code"></code></pre>
<div class="split">
<div><label>The first 12 values</label><ol id="values"></ol></div>
<div><label>20,000 draws</label><div id="chart"></div>
<div class="legend"><span><span class="key"></span>draws in each bin</span><span><span class="key line"></span>expected count</span></div>
<p id="stats"></p></div>
</div>
</div>
</section>
<section id="packages">
<h2>Packages</h2>
<div class="table"><table>
<thead><tr><th>Package</th><th>State</th><th>What it gives</th></tr></thead>
<tbody>
${table}
</tbody></table></div>
</section>
<section id="why">
<h2>Why</h2>
<p>The duplication atlas (<a href="https://mark1russell7.github.io/codeatlas/">codeatlas</a>) found the same seeded generator written by hand approximately 40 times, in more than 10 repositories. No repository imported it from a package. The copies use different forms of mulberry32, but each one gives the same numbers as <code>random(seed).next</code>. Thus a repository moves to the package with no change to its records, and its tests prove it.</p>
<pre><code>npm install @mark1russell7/rigor-generators

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
  const version = (name: string): string => (JSON.parse(readFileSync(join(here, `../${name}/package.json`), "utf8")) as { version: string }).version;
  writeFileSync(join(out, "index.html"), pageHtml(packageRows({ generators: version("generators"), statistics: version("statistics"), bench: version("bench") }), new Date().toISOString().slice(0, 10)));
  console.error(`wrote ${join(out, "index.html")} and page.js`);
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
