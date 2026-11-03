/**
 * The page of the site. The pure part (the methods, the bins and the expected counts) has tests. The DOM part,
 * `start`, runs only in a browser: it reads the controls, draws, and shows the first values and a histogram.
 * The time-verdict explorer has its own files: `explorer.ts` and `explorer-view.ts`.
 */
import { random, type Random } from "@mark1russell7/rigor-generators";
import { startExplorer } from "./explorer-view.ts";
import { seedFrom } from "./seed.ts";

export { seedFrom };

/** One method of the generator that the page shows. A histogram has `bins` bins from `min` to `max`. */
export interface Method {
  readonly id: string;
  readonly label: string;
  /** The code that the page shows for the method. */
  readonly code: string;
  readonly min: number;
  readonly max: number;
  readonly bins: number;
  /** One draw, as a number for the histogram. */
  draw(r: Random): number;
  /** One draw, as the text that the list of the first values shows. */
  show(r: Random): string;
  /** The probability of each bin. */
  expected(): number[];
}

const WEIGHTS = [1, 2, 3, 4];
const DECK = [1, 2, 3, 4, 5, 6, 7, 8];
const uniform = (bins: number): number[] => Array.from({ length: bins }, () => 1 / bins);
const fixed = (x: number): string => x.toFixed(4);

export const METHODS: readonly Method[] = [
  { id: "next", label: "next()", code: "r.next()", min: 0, max: 1, bins: 20, draw: (r) => r.next(), show: (r) => fixed(r.next()), expected: () => uniform(20) },
  { id: "int", label: "int(1, 6)", code: "r.int(1, 6)", min: 0.5, max: 6.5, bins: 6, draw: (r) => r.int(1, 6), show: (r) => String(r.int(1, 6)), expected: () => uniform(6) },
  {
    id: "normal",
    label: "normal()",
    code: "r.normal()",
    min: -4,
    max: 4,
    bins: 32,
    draw: (r) => r.normal(),
    show: (r) => fixed(r.normal()),
    // The histogram counts only the draws from -4 to 4, so the probabilities are of that range.
    expected: () => Array.from({ length: 32 }, (_, i) => (normalCdf(-4 + ((i + 1) * 8) / 32) - normalCdf(-4 + (i * 8) / 32)) / (normalCdf(4) - normalCdf(-4))),
  },
  {
    id: "weighted",
    label: "weighted([1, 2, 3, 4])",
    code: "r.weighted([1, 2, 3, 4])",
    min: -0.5,
    max: 3.5,
    bins: 4,
    draw: (r) => r.weighted(WEIGHTS),
    show: (r) => String(r.weighted(WEIGHTS)),
    expected: () => WEIGHTS.map((w) => w / 10),
  },
  {
    id: "shuffle",
    label: "shuffle([1 … 8]): the place of 1",
    code: "r.shuffle([1, 2, 3, 4, 5, 6, 7, 8])",
    min: -0.5,
    max: 7.5,
    bins: 8,
    draw: (r) => r.shuffle(DECK).indexOf(1),
    show: (r) => r.shuffle(DECK).join(" "),
    expected: () => uniform(8),
  },
];

/** The generator of the page: the seed, then the fork with the label, if there is a label. */
export function generatorOf(seedText: string, label: string): Random {
  const r = random(seedFrom(seedText));
  return label.trim() === "" ? r : r.fork(label.trim());
}

/** The counts of the values in `bins` equal bins from `min` to `max`. A value out of the range is not counted. */
export function histogram(values: readonly number[], min: number, max: number, bins: number): number[] {
  const counts = new Array<number>(bins).fill(0);
  const width = (max - min) / bins;
  for (const v of values) {
    if (!(v >= min && v < max)) continue;
    const i = Math.min(bins - 1, Math.floor((v - min) / width));
    counts[i] = (counts[i] ?? 0) + 1;
  }
  return counts;
}

/**
 * Pearson's chi-squared statistic divided by its degrees of freedom (the bins less 1). Its mean is 1 when the
 * draws follow the expected probabilities. A bin with an expected count under 1 is not counted.
 */
export function chiSquarePerDf(counts: readonly number[], probabilities: readonly number[]): number {
  const n = counts.reduce((a, b) => a + b, 0);
  let chi = 0;
  let k = 0;
  for (let i = 0; i < counts.length; i++) {
    const e = n * (probabilities[i] ?? 0);
    if (e < 1) continue;
    chi += ((counts[i] ?? 0) - e) ** 2 / e;
    k++;
  }
  return k > 1 ? chi / (k - 1) : Number.NaN;
}

/** The standard normal distribution function, from erf (Abramowitz and Stegun 7.1.26, error under 1.5e-7). */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** The first values and the histogram data of one method, for one seed and label. */
export function run(method: Method, seedText: string, label: string, n: number, first = 12) {
  const shown = generatorOf(seedText, label);
  const values = Array.from({ length: first }, () => method.show(shown));
  const r = generatorOf(seedText, label);
  const draws = Array.from({ length: n }, () => method.draw(r));
  const counts = histogram(draws, method.min, method.max, method.bins);
  const probabilities = method.expected();
  return { seed: shown.seed, values, counts, probabilities, chi: chiSquarePerDf(counts, probabilities) };
}

/* ---------- The DOM part ---------- */

const SVG = "http://www.w3.org/2000/svg";
const N = 20_000;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function binLabel(m: Method, i: number): string {
  const width = (m.max - m.min) / m.bins;
  if (m.id === "next" || m.id === "normal") return `${(m.min + i * width).toFixed(2)} to ${(m.min + (i + 1) * width).toFixed(2)}`;
  if (m.id === "int") return String(i + 1);
  if (m.id === "shuffle") return `place ${i + 1}`;
  return `index ${i}`;
}

function drawHistogram(host: HTMLElement, tip: HTMLElement, m: Method, counts: readonly number[], probabilities: readonly number[]): void {
  host.replaceChildren();
  const W = 640;
  const H = 220;
  const pad = { l: 8, r: 8, t: 12, b: 24 };
  const n = counts.reduce((a, b) => a + b, 0);
  const expected = probabilities.map((p) => p * n);
  const top = Math.max(...counts, ...expected) * 1.08;
  const bw = (W - pad.l - pad.r) / m.bins;
  const y = (v: number): number => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `A histogram of ${N} draws of ${m.label}, with the expected count of each bin` });
  root.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0), class: "axis" }));
  counts.forEach((c, i) => {
    const x = pad.l + i * bw + 1;
    const h = Math.max(0, y(0) - y(c));
    const rect = svg("rect", { x, y: y(c), width: Math.max(1, bw - 2), height: h, rx: Math.min(4, (bw - 2) / 2), class: "bar" });
    const hit = svg("rect", { x: pad.l + i * bw, y: pad.t, width: bw, height: H - pad.t - pad.b, class: "hit" });
    const show = (ev: MouseEvent): void => {
      tip.hidden = false;
      tip.textContent = `${binLabel(m, i)}: ${c} draws, ${(expected[i] ?? 0).toFixed(0)} expected`;
      tip.style.left = `${ev.clientX + 12}px`;
      tip.style.top = `${ev.clientY + 12}px`;
      rect.classList.add("on");
    };
    hit.addEventListener("mousemove", show);
    hit.addEventListener("mouseleave", () => {
      tip.hidden = true;
      rect.classList.remove("on");
    });
    root.append(rect, hit);
  });
  // The expected count of each bin, as a step line.
  let d = "";
  expected.forEach((e, i) => {
    const x0 = pad.l + i * bw;
    d += `${i === 0 ? "M" : "L"}${x0},${y(e)}H${x0 + bw}`;
  });
  root.append(svg("path", { d, class: "expected" }));
  const lo = svg("text", { x: pad.l, y: H - 6, class: "tick" });
  lo.textContent = m.id === "int" ? "1" : m.id === "next" || m.id === "normal" ? String(m.min) : "0";
  const hi = svg("text", { x: W - pad.r, y: H - 6, class: "tick", "text-anchor": "end" });
  hi.textContent = m.id === "int" ? "6" : m.id === "next" || m.id === "normal" ? String(m.max) : String(m.bins - 1);
  root.append(lo, hi);
  host.append(root);
}

export function start(): void {
  const seed = document.querySelector<HTMLInputElement>("#seed");
  const label = document.querySelector<HTMLInputElement>("#label");
  const pick = document.querySelector<HTMLElement>("#methods");
  const out = document.querySelector<HTMLElement>("#values");
  const chart = document.querySelector<HTMLElement>("#chart");
  const stats = document.querySelector<HTMLElement>("#stats");
  const code = document.querySelector<HTMLElement>("#code");
  const tip = document.querySelector<HTMLElement>("#tip");
  if (!seed || !label || !pick || !out || !chart || !stats || !code || !tip) return;
  let current: Method = METHODS[0] as Method;
  for (const m of METHODS) {
    const b = el("button", { type: "button", "aria-pressed": String(m === current) }, m.label);
    b.addEventListener("click", () => {
      current = m;
      for (const other of pick.querySelectorAll("button")) other.setAttribute("aria-pressed", String(other === b));
      render();
    });
    pick.append(b);
  }
  const render = (): void => {
    const result = run(current, seed.value, label.value, N);
    const fork = label.value.trim() === "" ? "" : `.fork(${JSON.stringify(label.value.trim())})`;
    const s = seedFrom(seed.value);
    code.textContent = `const r = random(${JSON.stringify(s)})${fork}; // seed ${result.seed}\n${current.code}`;
    out.replaceChildren(...result.values.map((v) => el("li", {}, v)));
    drawHistogram(chart, tip, current, result.counts, result.probabilities);
    stats.textContent = `${N.toLocaleString("en")} draws. χ² per degree of freedom: ${result.chi.toFixed(2)}. A value near 1 means that the draws fit the expected counts (the line).`;
  };
  seed.addEventListener("input", render);
  label.addEventListener("input", render);
  render();
}

if (typeof document !== "undefined") {
  start();
  startExplorer();
}
