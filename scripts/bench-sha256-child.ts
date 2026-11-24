// One child of the bench of sha256Hex. It times canonicalHash on a seeded set of documents in the shape of an alert event, and
// prints one JSON line for rigor-bench: the time in milliseconds and the hash of all the outputs.
//
//   node scripts/bench-sha256-child.ts --case native     (node:crypto, the default on Node)
//   node scripts/bench-sha256-child.ts --case portable   (the portable code, as in a browser)
//
// The runner scripts/bench-sha256.ts starts it in a fresh process for each arm and round.

const flag = process.argv.indexOf("--case");
const arm = flag >= 0 ? process.argv[flag + 1] : undefined;
if (arm !== "native" && arm !== "portable") throw new Error(`Give --case native or --case portable, not ${String(arm)}.`);
// The portable arm hides node:crypto before the module loads, so sha256Hex takes the code that a browser runs.
if (arm === "portable") Object.defineProperty(process, "getBuiltinModule", { value: () => undefined, configurable: true });

const { canonicalHash, sha256Hex } = await import("../packages/generators/src/hash.ts");
const { random } = await import("../packages/generators/src/random.ts");

const r = random("bench-sha256");
const severities = ["minor", "moderate", "severe", "extreme"];
/** The documents: 2000 events, each about 0.3 to 3 KB of canonical JSON, as an alerts pass hashes them. */
const docs = Array.from({ length: 2000 }, (_, i) => ({
  id: `event-${i}`,
  source: `source-${r.int(1, 40)}`,
  severity: severities[r.int(0, 3)],
  sent: 1_790_000_000_000 + r.int(0, 1_000_000_000),
  headline: "Flood warning for the river at the gauge ".repeat(r.int(1, 3)),
  areas: Array.from({ length: r.int(1, 12) }, () => `county-${r.int(1, 3200)}`),
  text: "The water rises above the flood stage tonight. ".repeat(r.int(4, 50)),
  score: r.int(0, 1000) / 1000,
  links: Array.from({ length: r.int(0, 4) }, (_, j) => ({ rel: `link-${j}`, url: `https://example.org/event/${i}/${j}` })),
}));

const pass = (): string[] => docs.map((d) => canonicalHash(d));
for (let i = 0; i < 3; i++) pass(); // Warm-up, so the time is of the optimized code.
const start = performance.now();
let outputs: string[] = [];
for (let i = 0; i < 5; i++) outputs = pass();
const ms = performance.now() - start;
console.log(JSON.stringify({ ms, hash: sha256Hex(outputs.join("")) }));
