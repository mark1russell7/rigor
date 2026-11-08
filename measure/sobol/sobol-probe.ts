import { sobolIndices, type RidgeResponseModel, type ResponseDimension } from "./src/index.ts";
const X = (id: string): ResponseDimension => ({ id, label: id, unit: "", kind: "continuous", range: [-1, 1] });
const num = (d: string) => ({ dimension: d, kind: "number" as const, center: 0, spread: 1 });
const model = (terms: RidgeResponseModel["terms"], dims: string[], intercept = 0): RidgeResponseModel => ({ measure: "y", scale: "linear", kind: "ridge", lambda: 0, inputs: dims.map(num), intercept, terms });
const p = (d: string) => ({ dimension: d, power: 1 });
const cases = {
  linear: { dims: [X("x1"), X("x2")], m: model([{ factors: [p("x1")], weight: 2 }, { factors: [p("x2")], weight: 1 }], ["x1", "x2"], 10), want: [[0.8, 0.8], [0.2, 0.2]] },
  product: { dims: [X("x1"), X("x2")], m: model([{ factors: [p("x1")], weight: 1 }, { factors: [p("x2")], weight: 1 }, { factors: [p("x1"), p("x2")], weight: 2 }], ["x1", "x2"]), want: [[0.3, 0.7], [0.3, 0.7]] },
};
for (const N of [16384]) for (const [name, c] of Object.entries(cases)) {
  const errs: number[][] = [];
  const t0 = performance.now();
  for (let s = 1; s <= 60; s++) {
    const r = sobolIndices({ dimensions: c.dims, models: [c.m] }, "y", { n: N, seed: s });
    errs.push(r.indices.flatMap((ix, i) => [ix.first - c.want[i]![0]!, ix.total - c.want[i]![1]!]));
  }
  const k = errs[0]!.length;
  const sd = Array.from({ length: k }, (_, j) => Math.sqrt(errs.reduce((a, e) => a + e[j]! ** 2, 0) / errs.length));
  const mx = Array.from({ length: k }, (_, j) => Math.max(...errs.map((e) => Math.abs(e[j]!))));
  console.log(N, name, "rmsErr[S1,ST1,S2,ST2]", sd.map((v) => v.toFixed(4)).join(" "), "max", mx.map((v) => v.toFixed(4)).join(" "), "ms/run", ((performance.now() - t0) / 60).toFixed(1));
}
