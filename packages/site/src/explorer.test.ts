import { describe, expect, it } from "vitest";
import { caseRatios, timeVerdict, verdictMargin } from "@mark1russell7/rigor-bench";
import { pageHtml, packageRows, scrollCueCss, verdictSection } from "./build.ts";
import { BADGE, callCode, factsText } from "./explorer-view.ts";
import {
  CASES,
  MARGIN,
  NOISE_CAP,
  POOL_RUNS,
  PRESETS,
  START,
  axisPlace,
  changeText,
  explore,
  mergePower,
  plainWhy,
  power,
  ratioText,
  simulate,
  verdictOptions,
} from "./explorer.ts";
import { readProbe } from "./probe-script.ts";

const bench = (id: string) => ({ ...PRESETS.find((p) => p.id === id)!.bench, seed: "42" });

describe("the simulated bench", () => {
  it("draws the records of the two pairs and of the pool", () => {
    const s = simulate(START);
    expect(s.candidate).toHaveLength(CASES * START.rounds);
    expect(s.aa).toHaveLength(CASES * START.rounds);
    expect(s.pool).toHaveLength(POOL_RUNS * CASES * START.rounds);
    for (const r of [...s.candidate, ...s.aa, ...s.pool]) expect(r.a > 0 && r.b > 0).toBe(true);
  });

  it("turns the order each round, so the package accepts each pair", () => {
    const s = simulate({ ...START, rounds: 5 });
    expect(caseRatios(s.candidate)).toHaveLength(CASES);
    expect(caseRatios(s.aa)).toHaveLength(CASES);
    expect(caseRatios(s.pool)).toHaveLength(POOL_RUNS * CASES);
    expect(s.candidate.slice(0, 3).map((r) => r.first)).toEqual(["a", "b", "a"]);
  });

  it("gives the same records for one seed, and other records for another seed", () => {
    expect(simulate(START)).toEqual(simulate(START));
    expect(simulate({ ...START, seed: "7" }).candidate[0]).not.toEqual(simulate(START).candidate[0]);
  });
});

describe("the verdict of the explorer", () => {
  it("is the verdict of timeVerdict for the same records and options", () => {
    const e = explore(START);
    expect(e.verdict).toEqual(timeVerdict(e.records.candidate, e.records.aa, verdictOptions(e.records)));
  });

  it("gives the same zone of verdictMargin: the wider of the margin and the pooled band", () => {
    for (const id of ["faster", "same", "slower", "noisy"]) {
      const e = explore(bench(id));
      expect(e.margin).toBe(verdictMargin(verdictOptions(e.records)));
      expect(e.margin).toBe(Math.max(MARGIN, e.verdict.band!.noise));
    }
    const same = explore(bench("same"));
    expect(same.verdict.interval!.low).toBeGreaterThanOrEqual(Math.exp(-same.margin));
    expect(same.verdict.interval!.high).toBeLessThanOrEqual(Math.exp(same.margin));
    expect(explore(bench("noisy")).margin).toBeGreaterThan(MARGIN);
  });

  it("uses the pooled band of the earlier runs and the noise cap", () => {
    const v = explore(START).verdict;
    expect(v.pool).toMatchObject({ cases: POOL_RUNS * CASES, runs: POOL_RUNS });
    expect(v.noise?.cap).toBe(NOISE_CAP);
    expect(v.band?.kind).toBe("case");
  });

  it("gives the outcome of each preset", () => {
    expect(explore(bench("faster")).verdict.outcome).toBe("faster");
    expect(explore(bench("same")).verdict.outcome).toBe("same");
    expect(explore(bench("slower")).verdict.outcome).toBe("slower");
    const noisy = explore(bench("noisy")).verdict;
    expect(noisy.outcome).toBe("cannot decide");
    expect(noisy.noise?.noisy).toBe(true);
  });

  it("shows the rule that same comes first: the interval of the preset same is below 1", () => {
    const v = explore(bench("same")).verdict;
    expect(v.interval!.high).toBeLessThan(1);
  });

  it("gives the verdicts that the probe expects", () => {
    expect(explore(START).verdict.outcome).not.toBe("cannot decide");
    expect(explore({ ...bench("faster"), ratio: 1.2 }).verdict.outcome).toBe("slower");
    expect(explore({ ...bench("faster"), ratio: 1.2, rounds: 31 }).records.candidate).toHaveLength(CASES * 31);
  });
});

describe("the power test", () => {
  it("gives the share of each outcome", () => {
    const e = explore(bench("faster"));
    const p = power(bench("faster"), e.records, 3);
    expect(p.trials).toBe(3);
    expect(Object.values(p.outcomes).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("adds the parts with the weight of their trials", () => {
    const zero = { faster: 0, slower: 0, same: 0, "cannot decide": 0 };
    const p = mergePower([
      { trials: 10, outcomes: { ...zero, faster: 1 }, power: 1 },
      { trials: 30, outcomes: { ...zero, faster: 0.5, same: 0.5 }, power: 0.5 },
    ]);
    expect(p.trials).toBe(40);
    expect(p.outcomes.faster).toBeCloseTo(0.625, 10);
    expect(p.outcomes.same).toBeCloseTo(0.375, 10);
    expect(p.power).toBeCloseTo(0.625, 10);
    expect(mergePower([]).trials).toBe(0);
  });
});

describe("the text and the axis of the explorer", () => {
  it("gives one plain sentence for each outcome", () => {
    for (const id of ["faster", "same", "slower", "noisy"]) {
      const text = plainWhy(explore(bench(id)).verdict);
      expect(text).toMatch(/^[A-Z][^;]*\.$/);
      expect(text.split(/\s+/).length).toBeLessThanOrEqual(25);
    }
    expect(plainWhy(explore(bench("noisy")).verdict)).toMatch(/noise cap/);
  });

  it("has a badge with a sign for each outcome", () => {
    expect(Object.keys(BADGE).sort()).toEqual(["cannot decide", "faster", "same", "slower"]);
  });

  it("places the ratios on a log axis with 1 in the middle", () => {
    expect(axisPlace(1)).toBeCloseTo(0.5, 10);
    expect(axisPlace(0.9)).toBeLessThan(axisPlace(1.1));
    expect(axisPlace(1.25) - 0.5).toBeCloseTo(0.5 - axisPlace(0.8), 10);
    expect(axisPlace(0.1)).toBe(0);
    expect(axisPlace(10)).toBe(1);
  });

  it("writes the ratios and the changes", () => {
    expect(changeText(0.9)).toBe("10% faster");
    expect(changeText(1.15)).toBe("15% slower");
    expect(changeText(1)).toBe("no change");
    expect(ratioText(0.8532)).toBe("0.85");
    expect(ratioText(0.9951)).toBe("0.995");
  });

  it("writes the facts of the verdict from its fields", () => {
    const e = explore(START);
    const v = e.verdict;
    const text = factsText(v, e.margin);
    expect(text).toContain(ratioText(Math.exp(e.margin)));
    expect(text).toContain(ratioText(v.band!.low));
    expect(text).toContain(ratioText(v.band!.high));
    expect(text).toContain(`${POOL_RUNS} earlier runs`);
    expect(callCode()).toContain("timeVerdict(candidate, aa");
  });
});

describe("the page of the explorer", () => {
  it("has the section, its link and the controls at the start values", () => {
    const html = pageHtml(packageRows({ generators: "0.1.0", statistics: "0.1.0", bench: "0.2.2" }), "2026-11-02");
    expect(html).toContain('href="#verdict"');
    expect(html).toContain('<section id="verdict">');
    expect(html.indexOf('id="try"')).toBeLessThan(html.indexOf('id="verdict"'));
    expect(verdictSection()).toContain(`id="vx-ratio" min="0.8" max="1.25" step="0.01" value="${START.ratio}"`);
    for (const id of ["vx-presets", "vx-rounds", "vx-seed", "vx-badge", "vx-why", "vx-chart", "vx-power-run", "vx-record-rows"]) expect(verdictSection()).toContain(`id="${id}"`);
  });

  it("puts the shared scroll cue in the style of the page", () => {
    const css = scrollCueCss();
    expect(css).toContain(".scroll-cue");
    expect(pageHtml([], "d", css)).toContain(css);
    expect(verdictSection()).toContain('class="records scroll-cue"');
  });
});

describe("the script of the site probe", () => {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<void>;
  const script = readProbe();

  it("has no types and no export", () => {
    expect(script).not.toMatch(/^export /m);
    expect(script).not.toMatch(/declare const/);
    expect(script).not.toMatch(/\): string =>/);
  });

  it("is the body of an async function with the helpers of the site check", () => {
    expect(() => new AsyncFunction("check", "wait", "until", "$", "$$", "type", "click", script)).not.toThrow();
  });

  it("sets the presets and checks the band and the interval", () => {
    for (const p of PRESETS) expect(script).toContain(`preset("${p.id}"`);
    expect(script).toContain("#vx-chart .band");
    expect(script).toContain("#vx-chart .interval");
  });
});
