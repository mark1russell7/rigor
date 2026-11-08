// This script runs one calibration study of the registry, and writes its raw counts and the result of its bar as JSON.
//
//   node scripts/calibration.ts --study u-statistic-interval --seed 1 --out calibration.json
//   node scripts/calibration.ts --study u-statistic-interval --seed smoke --draws 10 --cells "skewed 40/8,sparse 120/108" --out smoke.json
//
// The workflow calibration.yml starts it. A full run is heavy, so it runs in CI, not on a shared computer.
import { writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { study } from "../packages/statistics/src/calibration/registry.ts";

const FLAGS = ["--study", "--seed", "--draws", "--cells", "--out"] as const;
type Flag = (typeof FLAGS)[number];

const args = process.argv.slice(2);
const values = new Map<Flag, string>();
for (let i = 0; i < args.length; i += 2) {
  const flag = args[i] as Flag;
  const value = args[i + 1];
  if (!FLAGS.includes(flag) || value === undefined) throw new Error(`Give the flags ${FLAGS.join(", ")}, each with a value. Not ${args[i]}.`);
  values.set(flag, value);
}
const name = values.get("--study");
const seed = values.get("--seed");
const out = values.get("--out");
if (name === undefined || seed === undefined || out === undefined) throw new Error("Give --study, --seed and --out.");
const draws = values.get("--draws");
const cells = values.get("--cells");

const started = Date.now();
const record = study(name).run({
  seed,
  ...(draws === undefined ? {} : { draws: Number(draws) }),
  ...(cells === undefined ? {} : { cells: cells.split(",").map((c) => c.trim()) }),
});
const seconds = (Date.now() - started) / 1000;
const meta = { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model.trim() ?? "unknown", seconds };
// JSON has no Infinity, so the record writes an infinite result as the string "Infinity".
const minSample = Number.isFinite(record.result.minSample) ? record.result.minSample : "Infinity";
writeFileSync(out, `${JSON.stringify({ ...record, result: { ...record.result, minSample }, meta }, null, 2)}\n`);

console.log(`${record.study}, seed ${record.seed}, ${record.draws} draws in each of ${record.cells.length} cells.`);
for (const step of record.result.steps) {
  const pooled = `${step.hits}/${step.draws}, Wilson ${step.pooled.low.toFixed(4)} to ${step.pooled.high.toFixed(4)}`;
  console.log(`m >= ${step.sample}: ${step.reason} (${step.cells} cells, pooled ${pooled}, rejected: ${step.rejected.join("; ") || "none"})`);
}
console.log(`The smallest qualifying m is ${record.result.minSample}.`);
