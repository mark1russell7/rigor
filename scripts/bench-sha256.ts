// The bench of sha256Hex: node:crypto against the portable code, through canonicalHash, each arm in a fresh process, with an
// A/A pair of the native arm for the noise floor. It writes the raw times as JSON and prints the median ratio with a bootstrap
// interval. The workflow bench-sha256.yml starts it: timed runs go to CI, not to a shared computer.
//
//   node scripts/bench-sha256.ts --rounds 12 --out bench-sha256.json

import { writeFileSync } from "node:fs";
import { benchEnv, freshArms } from "../packages/bench/src/fresh.ts";
import { bootstrapMedianRatio } from "../packages/statistics/src/bootstrap.ts";

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
};
const rounds = Number(arg("--rounds", "12"));
const out = arg("--out", "bench-sha256.json");
if (!Number.isInteger(rounds) || rounds < 2) throw new Error(`--rounds is an integer of 2 or more, not ${rounds}.`);

const run = await freshArms({
  arms: [
    { id: "native", case: "native" },
    { id: "native-aa", case: "native" },
    { id: "portable", case: "portable" },
  ],
  aa: ["native", "native-aa"],
  command: [process.execPath, "scripts/bench-sha256-child.ts"],
  rounds,
  warmUp: 1,
  timeoutMs: 120_000,
});

const times = (arm: string): number[] => run.processes.filter((p) => p.arm === arm).map((p) => p.ms);
const native = times("native");
const aa = times("native-aa");
const portable = times("portable");
const speed = bootstrapMedianRatio(portable, native, { seed: 1 });
const noise = bootstrapMedianRatio(aa, native, { seed: 2 });
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

const lines = [
  `computer: ${JSON.stringify(benchEnv())}`,
  `rounds: ${run.rounds}, balanced: ${run.balanced}${run.warnings.length > 0 ? `, warnings: ${run.warnings.join("; ")}` : ""}`,
  `median ms of 5 passes over 2000 documents: native ${median(native).toFixed(1)}, portable ${median(portable).toFixed(1)}`,
  `portable / native: ${speed.estimate.toFixed(2)} (95 % interval ${speed.low.toFixed(2)} to ${speed.high.toFixed(2)})`,
  `A/A native / native: ${noise.estimate.toFixed(3)} (95 % interval ${noise.low.toFixed(3)} to ${noise.high.toFixed(3)})`,
  `decision: ${speed.low > noise.high ? "native is faster: the interval of the speed-up is above the A/A interval" : "no decision: the speed-up interval overlaps the A/A interval"}`,
];
console.log(lines.join("\n"));
writeFileSync(out, `${JSON.stringify({ env: benchEnv(), rounds: run.rounds, native, aa, portable, speed, noise, processes: run.processes }, null, 2)}\n`);
