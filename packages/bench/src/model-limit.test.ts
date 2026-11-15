import { mean, sd } from "@mark1russell7/rigor-statistics";
import { describe, expect, it } from "vitest";
import { type ModelRead, UNKNOWN_MODEL } from "./model.ts";
import {
  type ModelLimitsFile,
  MODEL_LIMIT_RULE,
  MODEL_LIMITS_FORMAT,
  candidateLimits,
  checkModelLimits,
  freezeLimits,
  limitChanges,
  modelLimitRead,
} from "./model-limit.ts";

/** This function gives one read for each value. */
function readsOf(model: string, values: readonly number[], caseName = "200-p2"): ModelRead[] {
  return values.map((value) => ({ case: caseName, model, value }));
}

const epyc = [10, 12, 11, 13, 9];
const xeon = [20, 22, 21, 23, 19, 20];
const stamp = { commit: "953a13fb", date: "2026-11-09" };
const reads = [...readsOf("EPYC 7763", epyc), ...readsOf("Xeon 8370C", xeon), ...readsOf("EPYC 9V74", [10, 11, 12])];
const frozen = freezeLimits("the p99 ms of the arm partition", candidateLimits(reads), stamp);

describe("candidateLimits", () => {
  it("gives the mean plus 3 standard deviations for each model with 5 reads or more", () => {
    const rows = candidateLimits(reads);
    expect(rows.map((row) => [row.model, row.status])).toEqual([
      ["EPYC 7763", "limit"],
      ["EPYC 9V74", "too-few"],
      ["Xeon 8370C", "limit"],
    ]);
    expect(rows[0]!.limit).toBeCloseTo(mean(epyc) + 3 * sd(epyc), 12);
    expect(rows[2]!.limit).toBeCloseTo(mean(xeon) + 3 * sd(xeon), 12);
    expect(rows[1]).toMatchObject({ mean: null, sd: null, limit: null, values: [10, 11, 12] });
  });

  it("gives the mean minus the floor when higher is better", () => {
    const [row] = candidateLimits(readsOf("EPYC 7763", epyc), { ...MODEL_LIMIT_RULE, better: "higher" });
    expect(row!.limit).toBeCloseTo(mean(epyc) - 3 * sd(epyc), 12);
  });

  it("gives no limit for reads that are all equal or have no CPU model", () => {
    const rows = candidateLimits([...readsOf("EPYC 7763", [5, 5, 5, 5, 5]), ...readsOf(UNKNOWN_MODEL, epyc)]);
    expect(rows.map((row) => [row.model, row.status, row.limit])).toEqual([
      ["EPYC 7763", "no-spread", null],
      [UNKNOWN_MODEL, "unknown-model", null],
    ]);
  });

  it("keeps the cases apart and sorts them", () => {
    const rows = candidateLimits([...readsOf("EPYC 7763", epyc, "200-p4"), ...readsOf("EPYC 7763", xeon, "200-p2")]);
    expect(rows.map((row) => [row.case, row.limit! > 20])).toEqual([
      ["200-p2", true],
      ["200-p4", false],
    ]);
  });

  it("stops on a value that is not finite and on a bad rule", () => {
    expect(() => candidateLimits(readsOf("EPYC 7763", [1, Number.NaN]))).toThrow(/not a finite number/);
    expect(() => candidateLimits(reads, { ...MODEL_LIMIT_RULE, k: 0 })).toThrow(/k is a positive number/);
    expect(() => candidateLimits(reads, { ...MODEL_LIMIT_RULE, minimum: 1 })).toThrow(/2 or more/);
  });
});

describe("freezeLimits and checkModelLimits", () => {
  it("freezes only the candidates with a limit, with their values, commit and date", () => {
    expect(frozen.format).toBe(MODEL_LIMITS_FORMAT);
    expect(Object.keys(frozen.limits["200-p2"]!)).toEqual(["EPYC 7763", "Xeon 8370C"]);
    expect(frozen.limits["200-p2"]!["EPYC 7763"]).toMatchObject({ values: epyc, commit: "953a13fb", date: "2026-11-09" });
    expect(checkModelLimits(frozen)).toEqual([]);
  });

  it("survives a round trip through JSON", () => {
    expect(checkModelLimits(JSON.parse(JSON.stringify(frozen)) as ModelLimitsFile)).toEqual([]);
  });

  it("finds a limit that its values do not give, and too few values", () => {
    const entry = frozen.limits["200-p2"]!["EPYC 7763"]!;
    const edited: ModelLimitsFile = {
      ...frozen,
      limits: { "200-p2": { "EPYC 7763": { ...entry, limit: entry.limit + 1 }, "Xeon 8370C": { ...entry, values: [1, 2, 3] } } },
    };
    const faults = checkModelLimits(edited);
    expect(faults).toHaveLength(2);
    expect(faults[0]).toMatch(/EPYC 7763: the limit is .* and the values give/);
    expect(faults[1]).toMatch(/Xeon 8370C: 3 values, and the rule needs 5/);
  });

  it("finds a bad format, a bad stamp and an unknown model", () => {
    expect(checkModelLimits({ ...frozen, format: "x" as typeof MODEL_LIMITS_FORMAT })).toEqual([`the format is x, not ${MODEL_LIMITS_FORMAT}`]);
    const entry = frozen.limits["200-p2"]!["EPYC 7763"]!;
    const faults = checkModelLimits({ ...frozen, limits: { "200-p2": { [UNKNOWN_MODEL]: { ...entry, date: "11/09/2026" } } } });
    expect(faults).toEqual([`200-p2 on ${UNKNOWN_MODEL}: a limit needs a known CPU model`, `200-p2 on ${UNKNOWN_MODEL}: the date is YYYY-MM-DD, not 11/09/2026.`]);
    expect(() => freezeLimits("m", [], { commit: "main", date: "2026-11-09" })).toThrow(/hex digits/);
  });
});

describe("modelLimitRead", () => {
  const limit = frozen.limits["200-p2"]!["EPYC 7763"]!.limit;

  it("passes a read at the limit and blocks a read past it", () => {
    expect(modelLimitRead(frozen, { case: "200-p2", model: "EPYC 7763", value: limit }).outcome).toBe("within");
    const past = modelLimitRead(frozen, { case: "200-p2", model: "EPYC 7763", value: limit + 0.001 });
    expect(past.outcome).toBe("beyond");
    expect(past.note).toMatch(/at most .* frozen at 953a13fb on 2026-11-09/);
  });

  it("gives no read for a model or a case with no frozen limit", () => {
    const fewReads = modelLimitRead(frozen, { case: "200-p2", model: "EPYC 9V74", value: 1 });
    expect(fewReads).toMatchObject({ outcome: "no read", limit: null });
    expect(fewReads.note).toMatch(/not a pass/);
    expect(modelLimitRead(frozen, { case: "200-p4", model: "EPYC 7763", value: 1 }).outcome).toBe("no read");
  });

  it("reads the other side when higher is better", () => {
    const rates = freezeLimits("writes a second", candidateLimits(readsOf("EPYC 7763", [200, 198, 199, 201, 197]), { ...MODEL_LIMIT_RULE, better: "higher" }), stamp, {
      ...MODEL_LIMIT_RULE,
      better: "higher",
    });
    expect(modelLimitRead(rates, { case: "200-p2", model: "EPYC 7763", value: 199 }).outcome).toBe("within");
    expect(modelLimitRead(rates, { case: "200-p2", model: "EPYC 7763", value: 150 }).outcome).toBe("beyond");
  });
});

describe("limitChanges", () => {
  const entry = frozen.limits["200-p2"]!["EPYC 7763"]!;
  /** This function gives the frozen file with a new entry for EPYC 7763. */
  const withEntry = (change: Partial<typeof entry>): ModelLimitsFile => ({
    ...frozen,
    limits: { "200-p2": { ...frozen.limits["200-p2"], "EPYC 7763": { ...entry, ...change } } },
  });

  it("accepts the same file, a tighter limit, a new model and a removed model", () => {
    expect(limitChanges(frozen, frozen).refused).toEqual([]);
    const tighter = limitChanges(frozen, withEntry({ limit: entry.limit - 1 }));
    expect(tighter.changes.find((c) => c.model === "EPYC 7763")?.kind).toBe("tighter");
    expect(tighter.refused).toEqual([]);
    const moved = limitChanges(frozen, { ...frozen, limits: { "200-p2": { "EPYC 7763": entry, "EPYC 9V45": entry } } });
    expect(moved.changes.map((c) => [c.model, c.kind])).toEqual([
      ["EPYC 7763", "same"],
      ["EPYC 9V45", "added"],
      ["Xeon 8370C", "removed"],
    ]);
    expect(moved.refused).toEqual([]);
  });

  it("refuses a looser limit with no reason or with the old reason", () => {
    const bare = limitChanges(frozen, withEntry({ limit: entry.limit + 1 }));
    expect(bare.changes.find((c) => c.model === "EPYC 7763")?.kind).toBe("looser");
    expect(bare.refused).toHaveLength(1);
    expect(bare.refused[0]).toMatch(/200-p2 on EPYC 7763: the limit goes from .* with no new reason/);
    const reasoned = withEntry({ limit: entry.limit + 1, reason: "the runner image changed to ubuntu 26.04" });
    expect(limitChanges(frozen, reasoned).refused).toEqual([]);
    const again = withEntry({ limit: entry.limit + 2, reason: "the runner image changed to ubuntu 26.04" });
    expect(limitChanges(reasoned, again).refused).toHaveLength(1);
    expect(limitChanges(frozen, withEntry({ limit: entry.limit + 1, reason: "  " })).refused).toHaveLength(1);
  });

  it("reads looser on the other side when higher is better", () => {
    const rule = { ...MODEL_LIMIT_RULE, better: "higher" as const };
    const high: ModelLimitsFile = { ...withEntry({}), rule };
    const lower: ModelLimitsFile = { ...withEntry({ limit: entry.limit - 1 }), rule };
    expect(limitChanges(high, lower).refused).toHaveLength(1);
    expect(limitChanges(lower, high).refused).toEqual([]);
  });

  it("refuses a change of the rule or the measure with no new ruleReason", () => {
    expect(limitChanges(frozen, { ...frozen, rule: { ...frozen.rule, k: 4 } }).refused).toEqual(["the rule or the measure changed with no new ruleReason"]);
    expect(limitChanges(frozen, { ...frozen, measure: "the p50 ms" }).refused).toHaveLength(1);
    expect(limitChanges(frozen, { ...frozen, rule: { ...frozen.rule, k: 4 }, ruleReason: "the strategist set k to 4" }).refused).toEqual([]);
    expect(() => limitChanges(frozen, { ...frozen, format: "x" as typeof MODEL_LIMITS_FORMAT })).toThrow(/format/);
  });
});
