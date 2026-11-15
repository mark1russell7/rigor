import { describe, expect, it } from "vitest";
import { type HealthSample, windowResponse } from "./window.ts";

const window = { from: 1000, to: 2000 };
const limits = { detectMs: 500, recoverMs: 500 };
/** This function gives one sample each 100 ms from 0 to `end`. The signal is down in each range of `down`. */
const series = (end: number, down: readonly (readonly [number, number])[]): HealthSample[] =>
  Array.from({ length: end / 100 + 1 }, (_, i) => {
    const at = i * 100;
    return { at, up: !down.some(([from, to]) => at >= from && at < to) };
  });

describe("the response of a health signal to a window", () => {
  it("passes when the signal goes down and comes up in the limits", () => {
    const response = windowResponse(window, series(3000, [[1200, 2300]]), limits);
    expect(response).toEqual({ detectMs: 200, recoverMs: 300, detected: "pass", recovered: "pass", problems: [] });
  });

  it("counts a sample at the start of the window as a detection", () => {
    expect(windowResponse(window, series(3000, [[1000, 2000]]), limits)).toMatchObject({ detectMs: 0, recoverMs: 0, detected: "pass", recovered: "pass" });
  });

  it("fails a late detection and a late recovery", () => {
    const response = windowResponse(window, series(4000, [[1700, 2800]]), limits);
    expect(response).toMatchObject({ detectMs: 700, recoverMs: 800, detected: "fail", recovered: "fail" });
    expect(response.problems).toEqual([
      "The signal went down after 700 ms, not in 500 ms of the start of the window.",
      "The signal came up after 800 ms, not in 500 ms of the end of the window.",
    ]);
  });

  it("fails a signal that does not come up, when the samples go past the limit", () => {
    const response = windowResponse(window, series(3000, [[1200, 9000]]), limits);
    expect(response.recoverMs).toBeUndefined();
    expect(response.recovered).toBe("fail");
    expect(response.problems).toEqual(["The signal did not come up in 500 ms of the end of the window."]);
  });

  it("counts the recovery from a detection after the end of the window", () => {
    const response = windowResponse(window, series(4000, [[2400, 2600]]), { detectMs: 2000, recoverMs: 500 });
    expect(response).toMatchObject({ detectMs: 1400, recoverMs: 200, detected: "pass", recovered: "pass" });
  });

  it("fails a signal that does not go down, and gives the recovery no read", () => {
    const response = windowResponse(window, series(3000, []), limits);
    expect(response).toMatchObject({ detected: "fail", recovered: "no read" });
    expect(response.problems).toEqual([
      "The signal did not go down in 500 ms of the start of the window.",
      "The signal did not go down, thus the recovery has no read.",
    ]);
  });

  it("gives no read when the samples end before a limit", () => {
    expect(windowResponse(window, series(1400, []), limits)).toMatchObject({ detected: "no read", recovered: "no read" });
    const early = windowResponse(window, series(2300, [[1200, 9000]]), limits);
    expect(early).toMatchObject({ detectMs: 200, detected: "pass", recovered: "no read" });
    expect(early.problems).toEqual(["The samples end before 500 ms after the end of the window."]);
  });

  it("gives no read when the signal is not steady and up before the window", () => {
    const cold = windowResponse(window, series(3000, [[0, 1000]]), limits);
    expect(cold).toMatchObject({ detected: "no read", recovered: "no read", problems: ["No sample before the window is up."] });
    const flaps = windowResponse(window, series(3000, [[500, 600], [1200, 2300]]), limits);
    expect(flaps).toMatchObject({ detected: "no read", recovered: "no read", problems: ["A sample before the window is down after the first sample up."] });
    // A signal that starts down and then comes up before the window is steady.
    expect(windowResponse(window, series(3000, [[0, 300], [1200, 2300]]), limits)).toMatchObject({ detected: "pass", recovered: "pass" });
  });

  it("throws for a window, limits or samples that are not valid", () => {
    expect(() => windowResponse({ from: 2000, to: 2000 }, [], limits)).toThrow(RangeError);
    expect(() => windowResponse(window, [], { detectMs: -1, recoverMs: 500 })).toThrow(RangeError);
    expect(() => windowResponse(window, [{ at: Number.NaN, up: true }], limits)).toThrow(RangeError);
    expect(() =>
      windowResponse(
        window,
        [
          { at: 200, up: true },
          { at: 100, up: true },
        ],
        limits,
      ),
    ).toThrow(/comes before/);
  });
});
