import { describe, expect, it } from "vitest";
import { kaplanMeier, survivalAt, survivalBand, survivalQuantile, type TimeToEvent } from "./survival.ts";

// The remission times in weeks of the 6-MP group of Freireich and others (1963). A `+` time is censored.
const SIX_MP = "6 6 6 6+ 7 9+ 10 10+ 11+ 13 16 17+ 19+ 20+ 22 23 25+ 32+ 32+ 34+ 35+";
const observations: TimeToEvent[] = SIX_MP.split(" ").map((item) => ({ time: Number.parseFloat(item), censored: item.endsWith("+") }));

describe("kaplanMeier", () => {
  it("gives the textbook estimate and the Greenwood errors of the 6-MP group", () => {
    const curve = kaplanMeier(observations);
    expect(curve.steps.map((step) => [step.time, step.atRisk, step.events])).toEqual([
      [6, 21, 3],
      [7, 17, 1],
      [10, 15, 1],
      [13, 12, 1],
      [16, 11, 1],
      [22, 7, 1],
      [23, 6, 1],
    ]);
    const chances = [0.8571, 0.8067, 0.7529, 0.6902, 0.6275, 0.5378, 0.4482];
    const errors = [0.0764, 0.0869, 0.0963, 0.1068, 0.1141, 0.1282, 0.1346];
    curve.steps.forEach((step, index) => {
      expect(step.chance).toBeCloseTo(chances[index] ?? Number.NaN, 4);
      expect(step.se).toBeCloseTo(errors[index] ?? Number.NaN, 4);
    });
    expect([curve.count, curve.events, curve.censored, curve.last]).toEqual([21, 9, 12, 35]);
  });

  it("gives the same curve for grouped times", () => {
    const groups = new Map<string, TimeToEvent & { count: number }>();
    for (const observation of observations) {
      const key = `${String(observation.time)}${observation.censored === true ? "+" : ""}`;
      const group = groups.get(key) ?? { ...observation, count: 0 };
      groups.set(key, { ...group, count: group.count + 1 });
    }
    expect(kaplanMeier([...groups.values()].reverse())).toEqual(kaplanMeier(observations));
  });

  it("gives the share of the times above each time when no time is censored", () => {
    const curve = kaplanMeier([3, 1, 2, 2].map((time) => ({ time })));
    expect(curve.steps.map((step) => [step.time, step.chance])).toEqual([
      [1, 0.75],
      [2, 0.25],
      [3, 0],
    ]);
    expect(curve.steps[2]?.se).toBe(0);
  });

  it("refuses an empty list, a negative time, a time that is not finite and a wrong count", () => {
    expect(() => kaplanMeier([])).toThrow(RangeError);
    expect(() => kaplanMeier([{ time: -1 }])).toThrow(RangeError);
    expect(() => kaplanMeier([{ time: Number.POSITIVE_INFINITY }])).toThrow(RangeError);
    expect(() => kaplanMeier([{ time: 1, count: 1.5 }])).toThrow(RangeError);
    expect(() => kaplanMeier([{ time: 1, count: 0 }])).toThrow(RangeError);
  });
});

describe("survivalAt and survivalQuantile", () => {
  const curve = kaplanMeier(observations);

  it("gives the chance of the step function, and no read after a last censored time", () => {
    expect(survivalAt(curve, 0)).toBe(1);
    expect(survivalAt(curve, 5.9)).toBe(1);
    expect(survivalAt(curve, 6)).toBeCloseTo(0.8571, 4);
    expect(survivalAt(curve, 34)).toBeCloseTo(0.4482, 4);
    expect(survivalAt(curve, 35)).toBeCloseTo(0.4482, 4);
    expect(survivalAt(curve, 36)).toBeUndefined();
    expect(survivalAt(kaplanMeier([{ time: 1 }, { time: 2 }]), 9)).toBe(0);
    expect(() => survivalAt(curve, -1)).toThrow(RangeError);
  });

  it("gives the median 23 of the 6-MP group, and no read for a chance that the curve does not get to", () => {
    expect(survivalQuantile(curve, 0.5)).toBe(23);
    expect(survivalQuantile(curve, 0.9)).toBe(6);
    expect(survivalQuantile(curve, 0.4)).toBeUndefined();
    expect(survivalQuantile(kaplanMeier([1, 2, 3, 4].map((time) => ({ time }))), 0.5)).toBe(2);
    expect(() => survivalQuantile(curve, 1)).toThrow(RangeError);
  });
});

describe("survivalBand", () => {
  const curve = kaplanMeier(observations);

  it("gives the log-log interval of the 6-MP group", () => {
    // The 95% log-log intervals of the 6-MP group (Freireich et al. 1963), as R survival gives them with conf.type "log-log".
    const expected: [number, number, number][] = [
      [6, 0.62, 0.952],
      [10, 0.503, 0.889],
      [23, 0.188, 0.68],
    ];
    for (const [time, low, high] of expected) {
      const band = survivalBand(curve, time);
      expect(band?.low).toBeCloseTo(low, 2);
      expect(band?.high).toBeCloseTo(high, 2);
      expect(band?.chance).toBe(survivalAt(curve, time));
    }
  });

  it("holds the chance in the interval, and the interval in the range 0 to 1", () => {
    for (let time = 0; time <= curve.last; time += 0.5) {
      const band = survivalBand(curve, time);
      if (band === undefined) throw new Error(`no read at ${time}`);
      expect(band.low).toBeGreaterThanOrEqual(0);
      expect(band.low).toBeLessThanOrEqual(band.chance);
      expect(band.chance).toBeLessThanOrEqual(band.high);
      expect(band.high).toBeLessThanOrEqual(1);
    }
  });

  it("gives a narrower interval with more observations of the same form, and no width at z 0", () => {
    const many = kaplanMeier(observations.map((item) => ({ ...item, count: 100 })));
    const few = survivalBand(curve, 16);
    const more = survivalBand(many, 16);
    expect(more?.chance).toBeCloseTo(few?.chance ?? 0, 12);
    expect((more?.high ?? 1) - (more?.low ?? 0)).toBeLessThan(((few?.high ?? 1) - (few?.low ?? 0)) / 5);
    expect(survivalBand(curve, 16, 0)).toEqual({ low: few?.chance, chance: few?.chance, high: few?.chance });
  });

  it("gives 1 to 1 before the first step, 0 to 0 at a chance of 0, and no read after an open end", () => {
    expect(survivalBand(curve, 1)).toEqual({ low: 1, chance: 1, high: 1 });
    expect(survivalBand(curve, curve.last + 1)).toBeUndefined();
    const closed = kaplanMeier([{ time: 1 }, { time: 2 }]);
    expect(survivalBand(closed, 3)).toEqual({ low: 0, chance: 0, high: 0 });
  });

  it("refuses a bad z and a bad time", () => {
    expect(() => survivalBand(curve, 6, -1)).toThrow(RangeError);
    expect(() => survivalBand(curve, 6, Number.NaN)).toThrow(RangeError);
    expect(() => survivalBand(curve, -1)).toThrow(RangeError);
  });
});
