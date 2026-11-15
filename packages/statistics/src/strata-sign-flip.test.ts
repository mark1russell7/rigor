import { describe, expect, it } from "vitest";
import { deriveSeed, mulberry32, random } from "@mark1russell7/rigor-generators";
import { SIGN_FLIP_EXACT_LIMIT, bootstrap, bootstrapStrata, mean, pairedPermutation, quantile, signFlipTest, signTest } from "./index.ts";

/** This function gives the exact two-sided p of whole-number terms from the distribution of the sums, with no enumeration of the sign sets. */
function exactByCounts(terms: readonly number[]): number {
  let counts = new Map<number, number>([[0, 1]]);
  for (const t of terms) {
    const next = new Map<number, number>();
    for (const [sum, c] of counts) {
      next.set(sum + t, (next.get(sum + t) ?? 0) + c);
      next.set(sum - t, (next.get(sum - t) ?? 0) + c);
    }
    counts = next;
  }
  const observed = Math.abs(terms.reduce((s, t) => s + t, 0));
  let hits = 0;
  for (const [sum, c] of counts) if (Math.abs(sum) >= observed) hits += c;
  return hits / 2 ** terms.length;
}

const meanOfMeans = (samples: readonly (readonly number[])[]): number => mean(samples.map((s) => mean(s)));

describe("signFlipTest", () => {
  it("gives the exact p of the distribution of the sums, for each count of terms from 0 to 12", () => {
    const r = random("sign-flip-exact");
    for (let n = 0; n <= 12; n++) {
      for (let k = 0; k < 20; k++) {
        const terms = Array.from({ length: n }, () => r.int(-6, 6));
        const result = signFlipTest(terms);
        expect(result.exact).toBe(true);
        expect(result.runs).toBe(2 ** n);
        expect(result.p).toBe(exactByCounts(terms));
      }
    }
  });

  it("gives small cases by hand", () => {
    expect(signFlipTest([])).toEqual({ observed: 0, p: 1, exact: true, runs: 1 });
    // The sets of [1, 2, 3]: the sums 6, 4, 2, 0, 0, -2, -4, -6. Two sets are as far as 6.
    expect(signFlipTest([1, 2, 3]).p).toBe(2 / 8);
    // A term of 0 adds nothing: the p of [0, 1, 2, 3] is the p of [1, 2, 3].
    expect(signFlipTest([0, 1, 2, 3]).p).toBe(2 / 8);
    expect(signFlipTest([1, -1]).p).toBe(1);
  });

  it("is the two-sided sign test when each term is 1 or -1", () => {
    for (let wins = 0; wins <= 12; wins++) {
      for (let losses = 0; wins + losses <= 12; losses++) {
        const terms = [...Array<number>(wins).fill(1), ...Array<number>(losses).fill(-1)];
        expect(signFlipTest(terms).p).toBeCloseTo(signTest(wins, losses, 2), 12);
      }
    }
  });

  it("does not change with the order of the terms, or when all the signs change", () => {
    const terms = [0.5, -1.25, 2, 0.75, -0.125, 3];
    const p = signFlipTest(terms).p;
    expect(signFlipTest([...terms].reverse()).p).toBe(p);
    expect(signFlipTest(terms.map((t) => -t)).p).toBe(p);
  });

  it("counts a sum that differs from the observed sum only by rounding as extreme", () => {
    // 0.1 + 0.2 and 0.3 in floating point are not equal, so a strict comparison loses the flip that gives the same sum.
    expect(signFlipTest([0.1, 0.2, -0.3]).p).toBe(1);
  });

  it("draws above exactMax with the draws of pairedPermutation against zeros", () => {
    const r = random("sign-flip-draws");
    const terms = Array.from({ length: 30 }, () => r.range(-1, 1.4));
    const drawn = signFlipTest(terms, { runs: 4000, seed: 7 });
    expect(drawn).toMatchObject({ exact: false, runs: 4000 });
    expect(drawn.p).toBe(pairedPermutation(terms, Array<number>(30).fill(0), { runs: 4000, seed: 7 }).p);
    expect(signFlipTest(terms.slice(0, 8), { exactMax: 0, runs: 500, seed: 3 }).exact).toBe(false);
  });

  it("gives the p of a loop over the stream of deriveSeed, so a copy with that stream can switch with equal numbers", () => {
    const terms = Array.from({ length: 20 }, (_, i) => ((i * 7) % 11) / 10 - 0.4);
    const seed = deriveSeed(42, "verdict.permutation");
    const rf = mulberry32(seed);
    const observed = Math.abs(terms.reduce((s, t) => s + t, 0));
    const slack = 1e-12 * terms.reduce((s, t) => s + Math.abs(t), 0);
    let hits = 0;
    for (let k = 0; k < 2000; k++) {
      let t = 0;
      for (const term of terms) t += rf() < 0.5 ? -term : term;
      if (Math.abs(t) >= observed - slack) hits++;
    }
    expect(signFlipTest(terms, { exactMax: 16, runs: 2000, seed }).p).toBe((hits + 1) / 2001);
  });

  it("refuses a term that is not finite, and a bad exactMax or runs", () => {
    expect(() => signFlipTest([1, Number.NaN])).toThrow("term 1");
    expect(() => signFlipTest([1], { exactMax: SIGN_FLIP_EXACT_LIMIT + 1 })).toThrow("exactMax");
    expect(() => signFlipTest([1], { exactMax: 1.5 })).toThrow("exactMax");
    expect(() => signFlipTest([1, 2], { exactMax: 0, runs: 0 })).toThrow("runs");
  });
});

describe("bootstrapStrata", () => {
  it("gives the interval of bootstrap when there is one stratum", () => {
    const data = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3];
    const options = { runs: 2000, seed: 11 };
    expect(bootstrapStrata([data], (s) => mean(s[0] as number[]), options)).toEqual(bootstrap(data, mean, options));
  });

  it("keeps the size of each stratum, and draws each item from its own stratum", () => {
    const strata = [
      [1, 2, 3],
      [10, 20],
      [100, 200, 300, 400],
    ];
    let checked = 0;
    bootstrapStrata(
      strata,
      (samples) => {
        expect(samples.map((s) => s.length)).toEqual([3, 2, 4]);
        samples.forEach((s, k) => s.forEach((x) => expect(strata[k]).toContain(x)));
        checked++;
        return 0;
      },
      { runs: 50 },
    );
    // The statistic of all the strata is one more call.
    expect(checked).toBe(51);
  });

  it("gives the interval of a loop that draws the items of each stratum in order, from the stream of deriveSeed", () => {
    const strata = [
      [0.5, -0.2, 0.9, 0.1],
      [1.5, 1.1],
      [-0.4, 0.3, 0.8],
    ];
    const seed = deriveSeed(5, "verdict.stratified");
    const rs = mulberry32(seed);
    const samples: number[] = [];
    for (let run = 0; run < 3000; run++) {
      let sum = 0;
      for (const list of strata) {
        let s = 0;
        for (let j = 0; j < list.length; j++) s += list[Math.floor(rs() * list.length)] as number;
        sum += s / list.length;
      }
      samples.push(sum / strata.length);
    }
    const interval = bootstrapStrata(strata, meanOfMeans, { runs: 3000, seed, ends: [0.025, 0.975] });
    expect(interval.estimate).toBe(meanOfMeans(strata));
    expect(interval.low).toBeCloseTo(quantile(samples, 0.025), 12);
    expect(interval.high).toBeCloseTo(quantile(samples, 0.975), 12);
  });

  it("gives a narrower interval than a pooled bootstrap when the strata differ in their means", () => {
    const strata = [
      [0, 0.1, -0.1, 0.05],
      [10, 10.1, 9.9, 10.05],
    ];
    const strat = bootstrapStrata(strata, (s) => mean(s.flat()), { runs: 2000 });
    const pooled = bootstrap(strata.flat(), mean, { runs: 2000 });
    expect(strat.high - strat.low).toBeLessThan((pooled.high - pooled.low) / 5);
  });

  it("refuses no stratum and an empty stratum", () => {
    expect(() => bootstrapStrata([], () => 0)).toThrow("no stratum");
    expect(() => bootstrapStrata([[1], []], () => 0)).toThrow("stratum 1");
  });
});
