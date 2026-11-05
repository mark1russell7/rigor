import { random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import { GATE_LOOKS, type JobRecords, type PairedTime, firstArm, gateOf, limitVerdict, notSlowerVerdict } from "./index.ts";

const MARGIN = Math.log(1.015);

/** The records of one arm: `rounds` rounds of each case, with a seeded noise of about `noise` on arm b, and turned orders. */
function arm(cases: number, rounds: number, factor: (c: number) => number, seed: number, noise = 0.004, offset = 0): PairedTime[] {
  const r = random(seed);
  const out: PairedTime[] = [];
  for (let c = 0; c < cases; c++) {
    for (let round = 0; round < rounds; round++) {
      out.push({ case: `c${String(c).padStart(2, "0")}`, round, first: firstArm(round, offset), a: 100, b: 100 * factor(c) * (1 + noise * (r.next() - 0.5)) });
    }
  }
  return out;
}

/** The records of `count` jobs. The A/A arm of each job has the opposite order in each round, as `freshRun` can give it. */
function jobs(count: number, cases: number, rounds: number, factor: (c: number) => number, seed: number, noise = 0.004): JobRecords[] {
  return Array.from({ length: count }, (_, j) => ({
    job: String(j + 1),
    candidate: arm(cases, rounds, factor, seed + 2 * j, noise),
    aa: arm(cases, rounds, () => 1, seed + 2 * j + 1, noise, 1),
  }));
}

describe("gateOf", () => {
  it("gives a block for a case beyond, also beside a case with no outcome", () => {
    const gate = gateOf([
      { case: "a", outcome: "within" },
      { case: "b", outcome: "cannot decide" },
      { case: "c", outcome: "beyond" },
    ]);
    expect(gate.outcome).toBe("block");
    expect(gate.blocks).toEqual(["c"]);
    expect(gate.noRead).toEqual(["b"]);
  });

  it("does not count a case with no outcome as a pass", () => {
    const gate = gateOf([
      { case: "a", outcome: "within" },
      { case: "b", outcome: "cannot decide" },
    ]);
    expect(gate.outcome).toBe("no read");
    expect(gate.reason).toContain('"b"');
  });

  it("gives a pass when each case is within, and no read with no cases", () => {
    expect(gateOf([{ case: "a", outcome: "within" }]).outcome).toBe("pass");
    expect(gateOf([]).outcome).toBe("no read");
  });

  it("reads the cases of a limit verdict", () => {
    const rows = arm(6, 12, () => 1, 3);
    const verdict = limitVerdict(rows, arm(6, 12, () => 1, 4), { limit: 2 });
    expect(verdict.outcome).toBe("within");
    expect(gateOf(verdict.cases).outcome).toBe("pass");
  });
});

describe("notSlowerVerdict", () => {
  it("passes A/A records of 16 cases at the first look when the noise is small", () => {
    const verdict = notSlowerVerdict(jobs(2, 16, 12, () => 1, 11), { margin: MARGIN });
    expect(verdict.outcome).toBe("pass");
    expect(verdict.cases).toHaveLength(16);
    for (const c of verdict.cases) {
      expect(c.read).toBe("not slower");
      expect(c.look).toBe(12);
    }
    expect(verdict.more).toEqual([]);
  });

  it("blocks a slowdown above the margin, and it names the case", () => {
    const verdict = notSlowerVerdict(jobs(2, 16, 12, (c) => (c === 3 ? 1.05 : 1), 12), { margin: MARGIN });
    expect(verdict.outcome).toBe("block");
    expect(verdict.blocks).toEqual(["c03"]);
    expect(verdict.cases[3]?.read).toBe("slower");
    expect(verdict.cases[3]?.outcome).toBe("beyond");
  });

  it("gives no read and the next look for a case at the margin", () => {
    const verdict = notSlowerVerdict(jobs(2, 4, 12, (c) => (c === 1 ? 1.015 : 1), 13), { margin: MARGIN });
    expect(verdict.outcome).toBe("no read");
    expect(verdict.noRead).toEqual(["c01"]);
    expect(verdict.more).toEqual([{ case: "c01", rounds: 24 }]);
    expect(verdict.cases[1]?.look).toBeUndefined();
    expect(verdict.cases[1]?.reason).toContain("no look");
  });

  it("gives an empty list `more` when the last look has no outcome", () => {
    const verdict = notSlowerVerdict(jobs(2, 2, 48, (c) => (c === 1 ? 1.015 : 1), 14), { margin: MARGIN });
    expect(verdict.outcome).toBe("no read");
    expect(verdict.more).toEqual([]);
  });

  it("needs the bound in each of 2 jobs: one good job with one bad job is no read", () => {
    const [good] = jobs(1, 1, 12, () => 1, 15);
    const [bad] = jobs(1, 1, 12, () => 1.05, 16);
    const verdict = notSlowerVerdict([good as JobRecords, { ...(bad as JobRecords), job: "2" }], { margin: MARGIN });
    expect(verdict.outcome).toBe("no read");
    expect(notSlowerVerdict([good as JobRecords], { margin: MARGIN }).outcome).toBe("no read");
    expect(notSlowerVerdict([good as JobRecords], { margin: MARGIN, jobs: 1 }).outcome).toBe("pass");
  });

  it("gives no read and the first look for a job with too few rounds", () => {
    const verdict = notSlowerVerdict(jobs(2, 1, 6, () => 1, 17), { margin: MARGIN });
    expect(verdict.outcome).toBe("no read");
    expect(verdict.more).toEqual([{ case: "c00", rounds: 12 }]);
    expect(verdict.cases[0]?.jobs.map((read) => read.rounds)).toEqual([6, 6]);
  });

  it("decides a case at its first look with an outcome, also when later rounds turn", () => {
    const records = jobs(2, 1, 24, () => 1, 18).map((job) => ({ ...job, candidate: job.candidate.map((r) => (r.round >= 12 ? { ...r, b: r.b * 1.2 } : r)) }));
    const verdict = notSlowerVerdict(records, { margin: MARGIN });
    expect(verdict.cases[0]?.read).toBe("not slower");
    expect(verdict.cases[0]?.look).toBe(12);
  });

  it("pairs records of one order, thus an effect of the order does not count", () => {
    // The arm that runs first takes 1.2 %. A pair of two orders has a difference of 2.4 % in each second round.
    const orderly = (rows: readonly PairedTime[]): PairedTime[] => rows.map((r) => ({ ...r, b: r.first === "b" ? r.b * 1.012 : r.b / 1.012 }));
    const records = jobs(2, 1, 12, () => 1, 19).map((job) => ({ ...job, candidate: orderly(job.candidate), aa: orderly(job.aa) }));
    expect(notSlowerVerdict(records, { margin: MARGIN }).outcome).toBe("pass");
  });

  it("takes a margin for each case", () => {
    const verdict = notSlowerVerdict(jobs(2, 2, 12, () => 1.03, 20), { margin: (name) => (name === "c00" ? Math.log(1.1) : MARGIN) });
    expect(verdict.cases.map((c) => c.read)).toEqual(["not slower", "slower"]);
    expect(verdict.cases.map((c) => c.margin)).toEqual([Math.log(1.1), MARGIN]);
  });

  it("gives no read with no jobs", () => {
    const verdict = notSlowerVerdict([], { margin: MARGIN });
    expect(verdict.outcome).toBe("no read");
    expect(verdict.looks).toBe(GATE_LOOKS);
  });

  it("refuses wrong options and a round that comes twice", () => {
    const records = jobs(2, 1, 12, () => 1, 21);
    expect(() => notSlowerVerdict(records, { margin: -1 })).toThrow(RangeError);
    expect(() => notSlowerVerdict(records, { margin: MARGIN, level: 0 })).toThrow(RangeError);
    expect(() => notSlowerVerdict(records, { margin: MARGIN, level: 1 })).toThrow(RangeError);
    expect(() => notSlowerVerdict(records, { margin: MARGIN, looks: [] })).toThrow(RangeError);
    expect(() => notSlowerVerdict(records, { margin: MARGIN, looks: [13] })).toThrow(RangeError);
    expect(() => notSlowerVerdict(records, { margin: MARGIN, looks: [24, 12] })).toThrow(RangeError);
    expect(() => notSlowerVerdict(records, { margin: MARGIN, jobs: 0 })).toThrow(RangeError);
    const first = records[0] as JobRecords;
    const twice = { ...first, candidate: [...first.candidate, first.candidate[0] as PairedTime] };
    expect(() => notSlowerVerdict([twice], { margin: MARGIN })).toThrow(/comes twice/);
  });

  it("keeps the false results at the level over 16 cases of A/A noise at the margin", () => {
    // Each case has its true median at the margin, the worst case of each claim. The noise is wide, so a read is rare.
    const runs = 200;
    let falsePass = 0;
    let falseBlock = 0;
    for (let run = 0; run < runs; run++) {
      const verdict = notSlowerVerdict(jobs(2, 16, 12, () => 1.015, 1000 + run * 10, 0.05), { margin: MARGIN, looks: [12] });
      if (verdict.cases.some((c) => c.read === "not slower")) falsePass++;
      if (verdict.cases.some((c) => c.read === "slower")) falseBlock++;
    }
    expect(falsePass / runs).toBeLessThanOrEqual(0.05);
    expect(falseBlock / runs).toBeLessThanOrEqual(0.05);
  });
});
