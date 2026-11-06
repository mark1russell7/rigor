// This script reads the code stamps of one operating system, or compares the reads of two.
//
//   node scripts/stamp-os.ts read <repository> <out.json>
//   node scripts/stamp-os.ts compare <a.json> <b.json>
//
// The compare also takes a copy of the second read with an injected fault. That copy must fail, so a compare that cannot fail ends with an error.
import { readFileSync, writeFileSync } from "node:fs";
import { readStampOs, type StampOsRead, stampOsFindings, withInjectedFault } from "../packages/bench/src/stamp-os.ts";

const [command, first, second] = process.argv.slice(2);
if (first === undefined || second === undefined) throw new Error("Give read <repository> <out.json>, or compare <a.json> <b.json>.");

if (command === "read") {
  const read = await readStampOs(first);
  writeFileSync(second, `${JSON.stringify(read, null, 2)}\n`);
  console.log(`${read.platform}: ${Object.entries(read.rows).map(([name, row]) => `${name} ${row.hash.slice(0, 12)}`).join(", ")}`);
} else if (command === "compare") {
  const parse = (file: string): StampOsRead => JSON.parse(readFileSync(file, "utf8")) as StampOsRead;
  const a = parse(first);
  const b = parse(second);
  const found = stampOsFindings(a, b);
  const injected = stampOsFindings(a, withInjectedFault(b));
  console.log(`${a.platform} against ${b.platform}: ${found.length} findings. The copy with a fault: ${injected.length} findings.`);
  for (const line of found) console.log(line);
  if (injected.length === 0) console.log("The copy with a fault has no finding, so this compare cannot fail.");
  process.exit(found.length === 0 && injected.length > 0 ? 0 : 1);
} else {
  throw new Error(`No command ${String(command)}.`);
}
