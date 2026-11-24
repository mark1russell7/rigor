/**
 * The kind of a machine inside one CPU model: the fields of `/proc/cpuinfo` that can split the jobs of one model.
 * The parser is pure. `benchEnv` of the entry /fresh reads the file on Linux and gives the result.
 */

/**
 * The kind of the machine of a job, from the first processor of `/proc/cpuinfo`. Each field is absent when the file does not give it.
 * Two jobs on one CPU model can have two levels of time. These fields can tell the two kinds apart.
 * The record has no clock speed. The `cpu MHz` of the file is the speed at the time of the read, so it changes in one job.
 */
export interface BenchMachine {
  /** The CPU family, for example `"25"`. */
  readonly family?: string;
  /** The model number of the CPU, for example `"17"`. It is not the name of the model. */
  readonly model?: string;
  /** The stepping of the CPU, for example `"1"`. */
  readonly stepping?: string;
  /** The microcode version, for example `"0xa101144"`. */
  readonly microcode?: string;
  /** The cache size of the line `cache size`, in KB. */
  readonly cacheKb?: number;
}

/** The fields of the file, by their names in it. */
const TEXT_FIELDS = [
  ["cpu family", "family"],
  ["model", "model"],
  ["stepping", "stepping"],
  ["microcode", "microcode"],
] as const;

/**
 * This function gives the kind of the machine from the text of `/proc/cpuinfo`. It reads only the first processor.
 * It gives `undefined` when the text has none of the fields.
 *
 * @param text - The text of `/proc/cpuinfo`
 * @returns The fields of the first processor, or `undefined`
 */
export function cpuInfoMachine(text: string): BenchMachine | undefined {
  const first = text.split(/\r?\n\s*\r?\n/).find((block) => block.trim() !== "") ?? "";
  const lines = new Map<string, string>();
  for (const line of first.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key !== "" && value !== "" && !lines.has(key)) lines.set(key, value);
  }
  const out: { -readonly [K in keyof BenchMachine]: BenchMachine[K] } = {};
  for (const [name, field] of TEXT_FIELDS) {
    const value = lines.get(name);
    if (value !== undefined) out[field] = value;
  }
  // The line is, for example, "cache size : 32768 KB". Another unit or form gives no field.
  const cache = /^(\d+(?:\.\d+)?)\s*KB$/i.exec(lines.get("cache size") ?? "");
  if (cache !== null) out.cacheKb = Number(cache[1]);
  return Object.keys(out).length === 0 ? undefined : out;
}
