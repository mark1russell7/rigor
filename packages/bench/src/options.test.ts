import { readFileSync } from "node:fs";
import { random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import { type PairedTime, aaBand, aaSpread, firstArm, pooledBand, timeVerdict } from "./index.ts";

/** The records of `cases` cases and `rounds` rounds, as in `bench.test.ts`. Arm b takes `factor` times arm a, with a seeded noise of about `spread`. */
function records(cases: number, rounds: number, factor: number, spread: number, seed: number, prefix = "c"): PairedTime[] {
  const r = random(seed);
  const out: PairedTime[] = [];
  for (let c = 0; c < cases; c++) {
    for (let round = 0; round < rounds; round++) {
      const a = 100 * (1 + spread * (r.next() - 0.5));
      const b = 100 * factor * (1 + spread * (r.next() - 0.5));
      out.push({ case: `${prefix}${c}`, round, first: firstArm(round, c), a, b });
    }
  }
  return out;
}

/** The records of the ratios `ratios`, one case for each ratio. */
const ofRatios = (ratios: readonly number[], prefix = "p"): PairedTime[] => ratios.map((r, k) => ({ case: `${prefix}${k}`, round: 0, first: "a", a: 10, b: 10 * r }));

describe("the defaults of the new options", () => {
  // The file holds the output of 0.1.0 on the fixtures of `bench.test.ts`. The new options are off by default, so the output stays byte-equal.
  const pinned = JSON.parse(readFileSync(new URL("../test/fixtures/verdict-0.1.0.json", import.meta.url), "utf8")) as unknown;

  it("gives the output of 0.1.0 on the fixtures", () => {
    const aa = records(20, 5, 1, 0.1, 11, "aa");
    const options = { bootstrap: { runs: 2000, seed: 3 } };
    const aa2 = records(20, 5, 1, 0.1, 21, "aa");
    const bootstrap = { runs: 1000, seed: 5 };
    const list: PairedTime[] = [0.5, 0.9, 1, 1.1, 2].map((ratio, c) => ({ case: `k${c}`, round: 0, first: "a", a: 10, b: 10 * ratio }));
    const verdicts = [
      timeVerdict(records(20, 5, 0.8, 0.1, 12), aa, options),
      timeVerdict(records(20, 5, 1.25, 0.1, 13), aa, options),
      timeVerdict(records(40, 5, 1, 0.02, 14), aa, options),
      timeVerdict(records(6, 1, 1.03, 0.3, 15), aa, options),
      timeVerdict(records(20, 5, 0.5, 0.1, 16), [], options),
      timeVerdict([], aa),
      timeVerdict(records(20, 5, 0.8, 0.1, 22), aa2, { rule: "band", kind: "case", bootstrap }),
      timeVerdict(list, aa2, { bootstrap }),
    ];
    const bands = [aaBand(aa2, { kind: "case" }), aaBand(aa2, { kind: "median", bootstrap })];
    expect(JSON.stringify({ verdicts, bands }, null, 2)).toBe(JSON.stringify(pinned, null, 2));
    for (const v of verdicts) {
      expect(v).not.toHaveProperty("pool");
      expect(v).not.toHaveProperty("noise");
    }
  });
});

describe("aaSpread and pooledBand", () => {
  it("gives the quantile of abs(log(ratio)) over the A/A cases", () => {
    const ratios = [1, 1.01, 0.98, 1.03, 0.97, 1.02, 0.99, 1.05, 0.96, 1];
    const logs = ratios.map((r) => Math.abs(Math.log(r))).sort((x, y) => x - y);
    // The level 0.9 of 10 values is at the rank 8.1, between the 9th and the 10th value.
    expect(aaSpread(ofRatios(ratios))).toBeCloseTo(logs[8]! + 0.1 * (logs[9]! - logs[8]!), 12);
    expect(aaSpread(ofRatios(ratios), 1)).toBeCloseTo(logs[9]!, 12);
    expect(() => aaSpread([])).toThrow(/no cases/);
  });

  it("takes the larger of the floor and the pooled spread", () => {
    const quiet = ofRatios([1, 1.01, 0.99, 1.02, 0.98, 1, 1.01, 0.99]);
    const loud = ofRatios([1, 1.1, 0.9, 1.12, 0.88, 1, 1.1, 0.9]);
    const floor = Math.log(1.05);
    const low = pooledBand({ records: quiet, floor });
    expect(low.noise).toBe(floor);
    expect(low.high).toBeCloseTo(1.05, 12);
    expect(low.kind).toBe("case");
    expect(low.cases).toBe(8);
    const high = pooledBand({ records: loud, floor });
    expect(high.noise).toBeCloseTo(aaSpread(loud), 12);
    expect(high.noise).toBeGreaterThan(floor);
    expect(pooledBand({ records: loud }).noise).toBe(high.noise);
  });

  it("uses the floor alone with fewer pooled cases than the minimum", () => {
    const few = pooledBand({ records: ofRatios([1.5, 0.6, 1.4]), floor: 0.05 });
    expect(few.noise).toBe(0.05);
    expect(few.cases).toBe(3);
    const none = pooledBand({ records: [], floor: 0.05 });
    expect(none.median).toBe(1);
    expect(none.cases).toBe(0);
    expect(pooledBand({ records: ofRatios([1.5, 0.6, 1.4]), floor: 0.05, minimum: 3 }).noise).toBeGreaterThan(0.3);
  });

  it("counts the runs of the pool with the option run", () => {
    const records = [...ofRatios([1, 1.01, 0.99], "run1 #"), ...ofRatios([1.02, 0.98], "run2 #")];
    const timed = timeVerdict(records, records, { pool: { records, run: (r) => r.case.split(" ")[0]! }, minimum: 5 });
    expect(timed.pool).toMatchObject({ cases: 5, runs: 2 });
    expect(timeVerdict(records, records, { pool: { records } }).pool!.runs).toBeUndefined();
  });

  it("refuses a bad floor or minimum", () => {
    expect(() => pooledBand({ records: [], floor: -0.1 })).toThrow(RangeError);
    expect(() => pooledBand({ records: [], floor: Number.NaN })).toThrow(RangeError);
    expect(() => pooledBand({ records: [], minimum: 0 })).toThrow(RangeError);
  });
});

describe("the noise cap and the pooled band of timeVerdict", () => {
  const aa = records(20, 5, 1, 0.1, 31, "aa");
  const bootstrap = { runs: 1000, seed: 7 };

  it("caps the noise: a spread above the cap cannot decide, and the reason names the outcome without the cap", () => {
    const c = records(20, 5, 0.8, 0.1, 32);
    const free = timeVerdict(c, aa, { bootstrap });
    expect(free.outcome).toBe("faster");
    const spread = aaSpread(aa);
    const capped = timeVerdict(c, aa, { bootstrap, noiseCap: spread / 2 });
    expect(capped.outcome).toBe("cannot decide");
    expect(capped.reason).toMatch(/above the noise cap/);
    expect(capped.reason).toMatch(/Without the cap, the outcome is "faster"/);
    expect(capped.noise).toEqual({ spread, cap: spread / 2, noisy: true });
    expect(capped.interval).toEqual(free.interval);
    const loose = timeVerdict(c, aa, { bootstrap, noiseCap: spread });
    expect(loose.outcome).toBe("faster");
    expect(loose.noise!.noisy).toBe(false);
    expect(loose.reason).toBe(free.reason);
    expect(timeVerdict(c, aa, { bootstrap, noiseCap: spread, spreadLevel: 1 }).noise!.spread).toBe(aaSpread(aa, 1));
  });

  it("keeps the reasons of the early outcomes under the cap", () => {
    const none = timeVerdict(records(20, 5, 0.5, 0.1, 33), [], { bootstrap, noiseCap: 0.01 });
    expect(none.reason).toMatch(/A\/A arm has 0 cases/);
    expect(none.noise).toEqual({ spread: undefined, cap: 0.01, noisy: true });
    expect(() => timeVerdict([], aa, { noiseCap: -1 })).toThrow(RangeError);
    expect(() => timeVerdict([], aa, { noiseCap: Number.NaN })).toThrow(RangeError);
  });

  it("replaces the band of the run with the pooled band in the rule band", () => {
    const quiet = records(40, 1, 1, 0.01, 34, "pool");
    const floor = Math.log(1.2);
    const c = records(20, 5, 1.1, 0.02, 35);
    const v = timeVerdict(c, aa, { rule: "band", bootstrap, pool: { records: quiet, floor } });
    expect(v.band!.noise).toBe(floor);
    expect(v.pool).toEqual({ cases: 40, runs: undefined, spread: aaSpread(quiet), floor, pooled: false });
    expect(v.outcome).toBe("same");
    // The band of the run is narrower, so the same candidate is slower without the pool.
    expect(timeVerdict(c, aa, { rule: "band", bootstrap }).outcome).toBe("slower");
  });

  it("widens the margin of the rule difference to the noise of the pooled band", () => {
    const pool = { records: [], floor: Math.log(1.1) };
    // The interval [0.9753, 1.0618] holds 1 and crosses the default margin 0.05. It is in the margin log(1.1) of the pool.
    const near = records(10, 1, 1.02, 0.1, 38);
    const own = timeVerdict(near, aa, { bootstrap });
    expect(own.outcome).toBe("cannot decide");
    const wide = timeVerdict(near, aa, { bootstrap, pool });
    expect(wide.interval).toEqual(own.interval);
    expect(wide.outcome).toBe("same");
    expect(wide.reason).toMatch(/in the margin of 0.0953/);
    // A margin above the noise of the pool stays.
    expect(timeVerdict(near, aa, { bootstrap, pool, margin: 0.2 }).reason).toMatch(/in the margin of 0.2\./);
  });
});

describe("two runs of a sections time gate of highways", () => {
  // The times in ms of two CI runs of the sections gate of highways (pull request 261). Only the numbers are copied.
  // Each round is one pair of fresh processes, so each round is one case.
  const QUIET_RUN = {
    parent: [47610.329418999994, 47506.322808, 47487.854320000006, 47446.145854, 47447.748315, 49923.029063, 47284.464825, 46811.937421999995, 47108.747923, 47585.016307],
    commit: [47158.030836, 47682.833892, 47142.521974999996, 47601.866364999994, 47479.836192, 47006.330405, 47729.378247, 47180.727182, 47461.530891, 47402.194501],
    aa: [48770.135752, 47176.185466, 46690.717534, 46932.477268, 47111.371323, 47229.783745, 47066.134331, 47256.043170000004, 47564.476543000004, 47135.636158],
  };
  const NOISY_RUN = {
    parent: [29757.691467, 29999.559537999998, 30464.022094, 32287.155475, 31103.206093, 38562.127431999994, 42616.313579, 32942.246884, 30441.095981, 29399.976576999998],
    commit: [29098.504354, 28988.154562, 29418.959973, 31296.308381, 29802.027512, 29945.614937, 40727.867511, 32348.001687, 30857.424726, 34287.619812000004],
    aa: [29404.118021, 31449.429642000003, 31185.828029, 31124.415114, 29771.395763, 37101.331734, 40893.085517, 40556.433776, 36292.29369, 33748.567856],
  };
  const pairs = (a: readonly number[], b: readonly number[], prefix = "r"): PairedTime[] => a.map((ms, k) => ({ case: `${prefix}${k}`, round: 0, first: firstArm(k), a: ms, b: b[k]! }));
  const pool = { records: pairs(QUIET_RUN.parent, QUIET_RUN.aa, "41542329976 #"), floor: Math.log(1.05), run: (r: PairedTime) => r.case.split(" ")[0]! };
  const gate = (run: typeof QUIET_RUN) => timeVerdict(pairs(run.parent, run.commit), pairs(run.parent, run.aa), { noiseCap: 0.06, pool });

  it("the quiet run 41542329976 gives same", () => {
    const v = gate(QUIET_RUN);
    expect(v.noise!.spread).toBeCloseTo(0.0272, 4);
    expect(v.noise!.noisy).toBe(false);
    expect(v.pool!.floor).toBe(Math.log(1.05));
    // The 10 pooled cases come from one run, so they show the noise of one runner.
    expect(v.pool!.cases).toBe(10);
    expect(v.pool!.runs).toBe(1);
    expect(v.outcome).toBe("same");
    expect(v.interval!.low).toBeCloseTo(0.9913, 4);
    expect(v.interval!.high).toBeCloseTo(1.0162, 4);
  });

  it("the noisy run 41548965076 cannot decide under a cap of 0.06", () => {
    const v = gate(NOISY_RUN);
    expect(v.noise!.spread).toBeCloseTo(0.179, 3);
    expect(v.noise!.noisy).toBe(true);
    expect(v.outcome).toBe("cannot decide");
    expect(v.reason).toMatch(/^The A\/A spread of the run is 0.179, above the noise cap 0.06\./);
    // Under the rule band, the run is same without the cap: the interval of its median ratio is in the wide band of its own A/A arm.
    const band = { rule: "band", kind: "case" } as const;
    expect(timeVerdict(pairs(NOISY_RUN.parent, NOISY_RUN.commit), pairs(NOISY_RUN.parent, NOISY_RUN.aa), band).outcome).toBe("same");
    expect(timeVerdict(pairs(NOISY_RUN.parent, NOISY_RUN.commit), pairs(NOISY_RUN.parent, NOISY_RUN.aa), { ...band, noiseCap: 0.06 }).outcome).toBe("cannot decide");
  });
});
