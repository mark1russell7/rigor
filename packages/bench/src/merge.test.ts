import { random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import { type PairedTime, armVerdicts, balanceOrders, caseRatios, firstArm, pooledVerdict, timeVerdict } from "./index.ts";

/** A record with a job label, as `freshRun` gives it. */
type JobTime = PairedTime & { readonly job: string };

/**
 * The records of one job: `cases` cases and the global rounds `from` to `from + rounds - 1`.
 * Arm b takes `factor` times arm a, with a seeded noise of about `spread`.
 */
function jobRecords(job: string, cases: number, from: number, rounds: number, factor: number, spread: number, seed: string): JobTime[] {
  const r = random(seed);
  const out: JobTime[] = [];
  for (let c = 0; c < cases; c++) {
    for (let round = from; round < from + rounds; round++) {
      const a = 100 * (1 + spread * (r.next() - 0.5));
      const b = 100 * factor * (1 + spread * (r.next() - 0.5));
      out.push({ case: `c${c}`, round, first: firstArm(round, c), a, b, job });
    }
  }
  return out;
}

/** The records of 5 jobs of 5 rounds each, with global rounds. The factor of job `j` is `factors[j]`, and its spread is `spreads[j]`. */
function fiveJobs(name: string, factors: readonly number[], spreads: readonly number[] = [0.02, 0.02, 0.02, 0.02, 0.02]) {
  return factors.map((factor, j) => ({
    job: String(j),
    candidate: jobRecords(String(j), 20, 5 * j, 5, factor, spreads[j]!, `${name}-c${j}`),
    aa: jobRecords(String(j), 20, 5 * j, 5, 1, spreads[j]!, `${name}-aa${j}`),
  }));
}

describe("balanceOrders", () => {
  it("removes the records of the larger order with the highest rounds, and keeps the other records in their order", () => {
    const rec = (c: string, round: number, first: "a" | "b"): JobTime => ({ case: c, round, first, a: 1, b: 1, job: "0" });
    const list = [rec("x", 0, "a"), rec("x", 1, "b"), rec("y", 0, "b"), rec("x", 2, "a"), rec("x", 4, "a"), rec("y", 1, "a"), rec("x", 6, "a")];
    const { records, trimmed } = balanceOrders(list);
    expect(trimmed).toBe(2);
    expect(records.map((r) => `${r.case}${r.round}`)).toEqual(["x0", "x1", "y0", "x2", "y1"]);
    // The type of the records stays: the job label is still there.
    expect(records[0]!.job).toBe("0");
  });

  it("removes nothing from a case whose orders differ by 1 or less", () => {
    const list = jobRecords("0", 3, 0, 5, 1, 0.1, "even");
    expect(balanceOrders(list)).toEqual({ records: list, trimmed: 0 });
    expect(balanceOrders([])).toEqual({ records: [], trimmed: 0 });
  });

  it("makes the merged records of two jobs readable by caseRatios", () => {
    // Job 0 has the rounds 0 to 2, and job 1 the rounds 4 to 6. Each case then has 4 records of one order and 2 of the other.
    const merged = [...jobRecords("0", 4, 0, 3, 1, 0.1, "m0"), ...jobRecords("1", 4, 4, 3, 1, 0.1, "m1")];
    expect(() => caseRatios(merged)).toThrow(/order turns/);
    const { records, trimmed } = balanceOrders(merged);
    expect(trimmed).toBe(4);
    expect(caseRatios(records).map((c) => c.rounds)).toEqual([5, 5, 5, 5]);
    // The removed record of each case is its round 6.
    expect(records.some((r) => r.round === 6)).toBe(false);
  });
});

describe("pooledVerdict", () => {
  it("gives the time verdict of the merged and balanced records", () => {
    const jobs = fiveJobs("pool", [0.8, 0.8, 0.8, 0.8, 0.8]);
    const v = pooledVerdict(jobs, { margin: 0.05 });
    const pooled = timeVerdict(
      balanceOrders(jobs.flatMap((j) => j.candidate)).records,
      balanceOrders(jobs.flatMap((j) => j.aa)).records,
      { margin: 0.05 },
    );
    expect(v.pooled).toEqual(pooled);
    expect(v.outcome).toBe("faster");
    expect(v.reason).toBe(pooled.reason);
    expect(v.trimmed).toBe(0);
    expect(v.opposed).toEqual([]);
    expect(v.jobs.map((j) => j.job)).toEqual(["0", "1", "2", "3", "4"]);
    expect(v.jobs[2]!.verdict).toEqual(timeVerdict(jobs[2]!.candidate, jobs[2]!.aa, { margin: 0.05 }));
    expect(v.pooled.cases[0]!.rounds).toBe(25);
  });

  it("counts the records that the balance removes", () => {
    const jobs = [0, 4].map((from, j) => ({
      job: String(j),
      candidate: jobRecords(String(j), 6, from, 3, 0.8, 0.02, `t-c${j}`),
      aa: jobRecords(String(j), 6, from, 3, 1, 0.02, `t-aa${j}`),
    }));
    const v = pooledVerdict(jobs);
    expect(v.trimmed).toBe(12);
    expect(v.pooled.cases.map((c) => c.rounds)).toEqual([5, 5, 5, 5, 5, 5]);
  });

  it("keeps the pooled outcome when a noisy job cannot decide", () => {
    const jobs = fiveJobs("noisy", [0.8, 0.8, 0.8, 0.8, 0.8], [0.02, 0.02, 0.02, 0.02, 1.2]);
    const v = pooledVerdict(jobs, { noiseCap: 0.06 });
    expect(v.jobs[4]!.verdict.outcome).toBe("cannot decide");
    expect(v.jobs[4]!.verdict.noise?.noisy).toBe(true);
    expect(v.pooled.outcome).toBe("faster");
    expect(v.outcome).toBe("faster");
    expect(v.opposed).toEqual([]);
  });

  it("gives cannot decide when a job decides the opposite direction, and lists the job", () => {
    const jobs = fiveJobs("opposed", [0.8, 0.8, 0.8, 0.8, 1.5]);
    const v = pooledVerdict(jobs);
    expect(v.pooled.outcome).toBe("faster");
    expect(v.jobs[4]!.verdict.outcome).toBe("slower");
    expect(v.opposed).toEqual(["4"]);
    expect(v.outcome).toBe("cannot decide");
    expect(v.reason.startsWith(v.pooled.reason)).toBe(true);
    expect(v.reason).toContain(`the jobs "4" give "slower"`);
  });

  it("removes each case that a job skipped from all jobs", () => {
    const one = { job: "0", candidate: jobRecords("0", 5, 0, 5, 1.3, 0.05, "s0"), aa: jobRecords("0", 5, 0, 5, 1, 0.05, "s1") };
    const two = { job: "1", candidate: jobRecords("1", 5, 5, 5, 1.3, 0.05, "s2"), aa: jobRecords("1", 5, 5, 5, 1, 0.05, "s3") };
    const skipped = { ...two, skipped: [{ case: "c4" }, { case: "c1" }] };
    const result = pooledVerdict([one, skipped]);
    expect(result.dropped).toEqual(["c1", "c4"]);
    const left = (records: readonly PairedTime[]) => records.filter((r) => r.case !== "c1" && r.case !== "c4");
    expect(result.pooled).toEqual(timeVerdict(left([...one.candidate, ...two.candidate]), left([...one.aa, ...two.aa])));
    expect(result.jobs[0]!.verdict).toEqual(timeVerdict(left(one.candidate), left(one.aa)));
    expect(pooledVerdict([one, two]).dropped).toEqual([]);
  });

  it("refuses two jobs with one case and round, and two jobs with one label", () => {
    const one = { job: "0", candidate: jobRecords("0", 5, 0, 5, 1, 0.1, "d0"), aa: jobRecords("0", 5, 0, 5, 1, 0.1, "d1") };
    const two = { job: "1", candidate: jobRecords("1", 5, 0, 5, 1, 0.1, "d2"), aa: jobRecords("1", 5, 5, 5, 1, 0.1, "d3") };
    expect(() => pooledVerdict([one, two])).toThrow(/roundOffset/);
    expect(() => pooledVerdict([one, two])).toThrow(RangeError);
    expect(() => pooledVerdict([one, { ...one }])).toThrow(/two jobs have the label/);
    const other = { ...two, aa: jobRecords("1", 5, 10, 5, 1, 0.1, "d3"), candidate: jobRecords("9", 5, 5, 5, 1, 0.1, "d2") };
    expect(() => pooledVerdict([one, other])).toThrow(/a record of the job "1" has the job "9"/);
  });
});

describe("armVerdicts", () => {
  it("gives the verdict of each candidate pair against the A/A pair", () => {
    const fast = jobRecords("0", 20, 0, 5, 0.8, 0.02, "arm-fast");
    const slow = jobRecords("0", 20, 0, 5, 1.3, 0.02, "arm-slow");
    const aa = jobRecords("0", 20, 0, 5, 1, 0.02, "arm-aa");
    const verdicts = armVerdicts({ pairs: { fast, slow, "base~aa": aa } }, "base~aa");
    expect(Object.keys(verdicts)).toEqual(["fast", "slow"]);
    expect(verdicts["fast"]).toEqual(timeVerdict(fast, aa));
    expect(verdicts["fast"]!.outcome).toBe("faster");
    expect(verdicts["slow"]!.outcome).toBe("slower");
  });

  it("balances each pair, and refuses a missing A/A pair", () => {
    const fast = [...jobRecords("0", 6, 0, 3, 0.8, 0.02, "b0"), ...jobRecords("0", 6, 4, 3, 0.8, 0.02, "b1")];
    const aa = jobRecords("0", 6, 0, 5, 1, 0.02, "b2");
    expect(armVerdicts({ pairs: { fast, aa } }, "aa")["fast"]!.cases.map((c) => c.rounds)).toEqual([5, 5, 5, 5, 5, 5]);
    expect(() => armVerdicts({ pairs: { fast } }, "aa")).toThrow(/no pair "aa"/);
  });
});
