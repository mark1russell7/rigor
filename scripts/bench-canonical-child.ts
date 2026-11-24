// One child of the bench of canonicalJson. It times canonicalJson on a seeded set of nested plain records, and prints one JSON
// line for rigor-bench: the time in milliseconds, the hash of the arm and the digest of all the outputs.
//
//   node scripts/bench-canonical-child.ts --case main   (the frozen copy of version 0.2.3, from commit 90722e8)
//   node scripts/bench-canonical-child.ts --case new    (canonicalJson of this checkout)
//
// The runner scripts/bench-canonical.ts starts it in a fresh process for each arm and round.

const flag = process.argv.indexOf("--case");
const arm = flag >= 0 ? process.argv[flag + 1] : undefined;
if (arm !== "main" && arm !== "new") throw new Error(`Give --case main or --case new, not ${String(arm)}.`);

const { canonicalJson, sha256Hex } = await import("../packages/generators/src/hash.ts");
const { canonicalJsonV023 } = await import("../packages/generators/src/canonical-0.2.3.fixture.ts");
const { random } = await import("../packages/generators/src/random.ts");
const write: (value: unknown) => string = arm === "main" ? (v) => canonicalJsonV023(v) : (v) => canonicalJson(v);

const r = random("bench-canonical");
const kinds = ["reading", "event", "status", "notice"];
/** One record: about 20 nested objects and arrays, with strings, numbers, booleans and null. */
const record = (i: number): unknown => ({
  id: `record-${i}`,
  kind: kinds[r.int(0, 3)],
  version: r.int(1, 9),
  active: r.int(0, 1) === 1,
  meta: {
    source: { name: `source-${r.int(1, 40)}`, region: `region-${r.int(1, 12)}`, priority: r.int(0, 5) },
    sent: 1_790_000_000_000 + r.int(0, 1_000_000_000),
    tags: Array.from({ length: r.int(1, 5) }, () => `tag-${r.int(1, 200)}`),
    note: null,
  },
  place: { point: { lat: r.int(-9000, 9000) / 100, lon: r.int(-18000, 18000) / 100 }, box: [r.int(0, 99), r.int(0, 99), r.int(100, 199), r.int(100, 199)] },
  values: Array.from({ length: r.int(2, 6) }, (_, j) => ({ name: `value-${j}`, amount: r.int(-5000, 5000) / 100, unit: "m", flags: { checked: j % 2 === 0, final: false } })),
  links: Array.from({ length: r.int(0, 3) }, (_, j) => ({ rel: `link-${j}`, url: `https://example.org/record/${i}/${j}` })),
  history: [{ at: r.int(0, 1e6), state: "new" }, { at: r.int(1e6, 2e6), state: "seen" }],
  extra: {},
});
/** The records: half come from object literals, and half from JSON.parse, as a program gets them from a file or a reply. */
const docs = Array.from({ length: 3000 }, (_, i) => (i % 2 === 0 ? record(i) : (JSON.parse(JSON.stringify(record(i))) as unknown)));

const pass = (): string[] => docs.map(write);
for (let i = 0; i < 5; i++) pass(); // Warm-up, so the time is of the optimized code.
const start = performance.now();
let outputs: string[] = [];
for (let i = 0; i < 10; i++) outputs = pass();
const ms = performance.now() - start;
const digest = sha256Hex(outputs.join("\n"));
console.log(JSON.stringify({ ms, hash: digest, digest }));
