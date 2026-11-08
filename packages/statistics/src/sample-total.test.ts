import { describe, expect, it } from "vitest";
import { random } from "@mark1russell7/rigor-generators";
import { bootstrap, sampleTotalInterval, wilson } from "./index.ts";

// A made-up population of 200 item totals: a skewed law with values from 1 to approximately 60.
function population(size: number, seed: string): number[] {
  const r = random(seed);
  return Array.from({ length: size }, () => 1 + Math.floor(60 * r.next() * r.next()));
}

function total(values: readonly number[]): number {
  return values.reduce((s, t) => s + t, 0);
}

describe("sampleTotalInterval", () => {
  it("gives the point when the sample is the whole population", () => {
    const items = population(40, "whole");
    const i = sampleTotalInterval(items, { population: items.length, runs: 500, seed: 3 });
    expect(i.estimate).toBe(total(items));
    expect(i.low).toBe(i.estimate);
    expect(i.high).toBe(i.estimate);
    expect(i.finite).toBe(500);
  });

  it("is equal to the bootstrap with the correction at the call, to the bit", () => {
    const items = population(200, "consumer");
    const r = random("consumer-draw");
    const totals = r.sample(items, 60);
    const m = totals.length;
    const n = items.length;
    const seed = 17;
    const scale = n / m;
    const all = totals.reduce((s, t) => s + t, 0);
    const estimate = scale * all;
    const spread = Math.sqrt(1 - m / n) * scale;
    const expected = bootstrap([...totals], (drawn) => estimate + spread * (drawn.reduce((s, t) => s + t, 0) - all), { runs: 2000, seed });
    const got = sampleTotalInterval(totals, { population: n, runs: 2000, seed });
    expect(got).toEqual(expected);
    expect(Object.is(got.low, expected.low)).toBe(true);
    expect(Object.is(got.high, expected.high)).toBe(true);
    // A scale that the caller gives is used as it is.
    const given = sampleTotalInterval(totals, { population: n, scale: 3.25, runs: 300, seed });
    expect(given.estimate).toBe(3.25 * all);
  });

  it("holds the true total at the 95% level, at half of the population", () => {
    const items = population(200, "coverage");
    const truth = total(items);
    const r = random("coverage-samples");
    const samples = 400;
    let hits = 0;
    for (let k = 0; k < samples; k++) {
      const drawn = r.sample(items, 100);
      const i = sampleTotalInterval(drawn, { population: items.length, runs: 1000, seed: k + 1 });
      if (i.low <= truth && truth <= i.high) hits++;
    }
    const share = wilson(hits, samples);
    // The measured count at these seeds: 381 of 400 (0.9525), with the Wilson interval 0.927 to 0.969.
    expect(hits).toBe(381);
    expect(share.low).toBeLessThanOrEqual(0.95);
    expect(share.high).toBeGreaterThanOrEqual(0.95);
  });

  it("gets narrower as the sample gets near the population", () => {
    const items = population(200, "narrow");
    const order = random("narrow-order").shuffle(items);
    const widths = [50, 100, 150, 180, 195, 200].map((m) => {
      const i = sampleTotalInterval(order.slice(0, m), { population: items.length, runs: 2000, seed: 5 });
      return i.high - i.low;
    });
    for (let j = 1; j < widths.length; j++) expect(widths[j]).toBeLessThan(widths[j - 1] as number);
    expect(widths.at(-1)).toBe(0);
  });

  it("refuses a bad input", () => {
    expect(() => sampleTotalInterval([4], { population: 10 })).toThrow(RangeError);
    expect(() => sampleTotalInterval([], { population: 10 })).toThrow(RangeError);
    expect(() => sampleTotalInterval([1, 2, 3], { population: 2 })).toThrow(RangeError);
    expect(() => sampleTotalInterval([1, 2, 3], { population: 10.5 })).toThrow(RangeError);
    expect(() => sampleTotalInterval([1, Number.NaN], { population: 10 })).toThrow(RangeError);
    expect(() => sampleTotalInterval([1, Number.POSITIVE_INFINITY], { population: 10 })).toThrow(RangeError);
    expect(() => sampleTotalInterval([1, 2], { population: 10, scale: 0 })).toThrow(RangeError);
    expect(() => sampleTotalInterval([1, 2], { population: 10, scale: Number.NaN })).toThrow(RangeError);
    expect(() => sampleTotalInterval([1, 2], { population: 10, runs: 0 })).toThrow(RangeError);
  });
});
