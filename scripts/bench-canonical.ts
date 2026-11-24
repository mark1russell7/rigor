// The bench of canonicalJson: the frozen copy of version 0.2.3 (commit 90722e8) against canonicalJson of this checkout, each arm
// in a fresh process, with an A/A pair of the main arm for the noise floor. It writes the raw times as JSON and prints the
// median ratio with a bootstrap interval. The workflow bench-canonical.yml starts it: timed runs go to CI, not to a shared computer.
//
//   node scripts/bench-canonical.ts --rounds 12 --out bench-canonical.json

import { writeFileSync } from "node:fs";
import { benchEnv, freshArms } from "../packages/bench/src/fresh.ts";
import { bootstrapMedianRatio } from "../packages/statistics/src/bootstrap.ts";

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
};
const rounds = Number(arg("--rounds", "12"));
const out = arg("--out", "bench-canonical.json");
if (!Number.isInteger(rounds) || rounds < 2) throw new Error(`--rounds is an integer of 2 or more, not ${rounds}.`);

const run = await freshArms({
  arms: [
    { id: "main", case: "main" },
    { id: "main-aa", case: "main" },
    { id: "new", case: "new" },
  ],
  aa: ["main", "main-aa"],
  command: [process.execPath, "scripts/bench-canonical-child.ts"],
  rounds,
  warmUp: 1,
  timeoutMs: 120_000,
});

// The two arms must give the same text for each record. The digest is the hash of all the outputs of a child.
const digests = new Set(run.processes.map((p) => String(p.fields?.extra?.["digest"])));
if (digests.size !== 1) throw new Error(`The arms gave different outputs: ${[...digests].join(", ")}.`);

const times = (arm: string): number[] => run.processes.filter((p) => p.arm === arm).map((p) => p.ms);
const main = times("main");
const aa = times("main-aa");
const next = times("new");
const speed = bootstrapMedianRatio(next, main, { seed: 1 });
const noise = bootstrapMedianRatio(aa, main, { seed: 2 });
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const aaLow = Math.min(noise.low, 1);

const lines = [
  `computer: ${JSON.stringify(benchEnv())}`,
  `rounds: ${run.rounds}, balanced: ${run.balanced}${run.warnings.length > 0 ? `, warnings: ${run.warnings.join("; ")}` : ""}`,
  `outputs: the same text in each arm (digest ${[...digests][0]})`,
  `median ms of 10 passes over 3000 records: main ${median(main).toFixed(1)}, new ${median(next).toFixed(1)}`,
  `new / main: ${speed.estimate.toFixed(3)} (95 % interval ${speed.low.toFixed(3)} to ${speed.high.toFixed(3)})`,
  `A/A main / main: ${noise.estimate.toFixed(3)} (95 % interval ${noise.low.toFixed(3)} to ${noise.high.toFixed(3)})`,
  `decision: ${speed.high < aaLow ? "new is faster: the interval of the ratio is below the A/A interval" : "no decision: the interval of the ratio overlaps the A/A interval"}`,
];
console.log(lines.join("\n"));
writeFileSync(out, `${JSON.stringify({ env: benchEnv(), rounds: run.rounds, main, aa, new: next, speed, noise, processes: run.processes }, null, 2)}\n`);
