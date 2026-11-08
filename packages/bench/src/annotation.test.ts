import { describe, expect, it } from "vitest";
import { gateAnnotation } from "./annotation.ts";

const ONE_CPU = [{ cpu: "AMD EPYC 7763" }, { cpu: "AMD EPYC 7763" }];

describe("the check line of a gate read", () => {
  it("gives nothing for a pass", () => {
    expect(gateAnnotation({ gate: "store gate", outcome: "pass", reason: "all hold", cases: [], envs: ONE_CPU, enforced: true })).toBeUndefined();
  });

  it("gives an error for a no read of an enforced gate, with its cases and its CPU model", () => {
    const line = gateAnnotation({ gate: "store gate", outcome: "no read", reason: "too few rounds.", cases: ["read-1", "write-10"], envs: ONE_CPU, enforced: true });
    expect(line).toBe("::error title=store gate%3A no read%2C 2 cases::too few rounds. Cases: read-1, write-10. CPU AMD EPYC 7763.");
  });

  it("gives a warning for a gate that only reports, and names a mixed pair of CPU models", () => {
    const line = gateAnnotation({ gate: "fan-out", outcome: "no read", reason: "short run.", cases: ["total-100000"], envs: [{ cpu: "Intel Xeon 8370C" }, { cpu: "AMD EPYC 7763" }], enforced: false });
    expect(line).toBe("::warning title=fan-out%3A no read (report only)%2C 1 case::short run. Cases: total-100000. 2 CPU models (a mixed pair): AMD EPYC 7763 | Intel Xeon 8370C.");
  });

  it("gives an error for a block, and escapes the characters of a workflow command", () => {
    const line = gateAnnotation({ gate: "g", outcome: "block", reason: "100% slower\nin one job", cases: [], envs: [], enforced: true });
    expect(line).toBe("::error title=g%3A block%2C 0 cases::100%25 slower%0Ain one job no CPU model.");
  });
});
