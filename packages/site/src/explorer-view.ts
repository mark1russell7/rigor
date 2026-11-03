/**
 * The DOM part of the time-verdict explorer, for a browser only. It reads the controls, uses `explore` and draws
 * the records, the pooled A/A band, the interval of the candidate and the verdict of `@mark1russell7/rigor-bench`.
 */
import type { Power, TimeOutcome, TimeVerdict } from "@mark1russell7/rigor-bench";
import {
  type Bench,
  type Explored,
  MARGIN,
  PRESETS,
  ROUNDS,
  START,
  TICKS,
  axisPlace,
  changeText,
  explore,
  mergePower,
  plainWhy,
  power,
  ratioText,
} from "./explorer.ts";

const SVG = "http://www.w3.org/2000/svg";

/** The label of each outcome on the badge, with a sign, so the color is not the only cue. */
export const BADGE: Readonly<Record<TimeOutcome, string>> = { faster: "✓ Faster", slower: "✗ Slower", same: "= Same", "cannot decide": "? Cannot decide" };

function svg(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/** The tooltip of the page: one element that follows the pointer. */
function tipOn(tip: HTMLElement, target: SVGElement, text: () => string, mark?: SVGElement): void {
  const show = (ev: PointerEvent): void => {
    tip.hidden = false;
    tip.textContent = text();
    const x = Math.min(ev.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${ev.clientY + 14}px`;
    mark?.classList.add("on");
  };
  target.addEventListener("pointermove", show);
  target.addEventListener("pointerleave", () => {
    tip.hidden = true;
    mark?.classList.remove("on");
  });
}

/** This function draws the diagram: two rows of records, the verdict row and the axis. */
function drawChart(host: HTMLElement, tip: HTMLElement, result: Explored, bench: Bench): void {
  const W = Math.max(280, Math.round(host.clientWidth));
  const pad = { l: 10, r: 10 };
  const rowH = 46;
  const top = { candidate: 18, aa: 18 + rowH + 18, verdict: 18 + 2 * (rowH + 18) };
  const verdictH = 58;
  const axisY = top.verdict + verdictH + 6;
  const H = axisY + 24;
  const x = (ratio: number): number => pad.l + axisPlace(ratio) * (W - pad.l - pad.r);
  const v = result.verdict;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": `The records of the bench, the pooled A/A band and the interval of the candidate. The verdict is ${v.outcome}.` });

  // The axis and its ticks. The line at 1 goes over each row.
  root.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: axisY, y2: axisY, class: "axis" }));
  for (const t of TICKS) {
    if (W < 400 && (t === 0.7 || t === 1.4)) continue;
    root.append(svg("line", { x1: x(t), x2: x(t), y1: axisY, y2: axisY + 4, class: "axis" }));
    root.append(svg("text", { x: x(t), y: axisY + 17, class: "tick", "text-anchor": "middle" }, `${t}×`));
  }

  // The records: a light dot for each round (b / a), and a dark dot for each case ratio.
  const rows: { key: "candidate" | "aa"; label: string; series: string }[] = [
    { key: "candidate", label: `Candidate / baseline: ${bench.rounds} rounds of ${result.verdict.cases.length} cases`, series: "s-candidate" },
    { key: "aa", label: "A/A: the baseline against itself, in the same run", series: "s-aa" },
  ];
  for (const row of rows) {
    const y0 = top[row.key];
    root.append(svg("text", { x: pad.l, y: y0 - 5, class: "row-label" }, row.label));
    root.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: y0 + rowH / 2, y2: y0 + rowH / 2, class: "grid" }));
    const records = row.key === "candidate" ? result.records.candidate : result.records.aa;
    records.forEach((r, i) => {
      const jitter = (((i * 7) % 11) - 5) * 3;
      root.append(svg("circle", { cx: x(r.b / r.a), cy: y0 + rowH / 2 + jitter, r: 2.5, class: `rec ${row.series}` }));
    });
    const cases = row.key === "candidate" ? v.cases : result.aaCases;
    for (const c of cases) {
      const dot = svg("circle", { cx: x(c.ratio), cy: y0 + rowH / 2, r: 5, class: `case ${row.series}` });
      const hit = svg("circle", { cx: x(c.ratio), cy: y0 + rowH / 2, r: 11, class: "hit" });
      tipOn(tip, hit, () => `${c.case}: ratio ${ratioText(c.ratio)} over ${c.rounds} rounds`, dot);
      root.append(dot, hit);
    }
  }

  // The verdict row: the pooled A/A band, the margin, the true ratio and the interval of the candidate.
  const yv = top.verdict;
  const mid = yv + verdictH / 2 + 6;
  root.append(svg("text", { x: pad.l, y: yv - 5, class: "row-label" }, "The verdict: the interval of the candidate over A/A"));
  if (v.band !== undefined) {
    const band = v.band;
    const rect = svg("rect", { x: x(band.low), y: yv + 6, width: Math.max(1, x(band.high) - x(band.low)), height: verdictH - 6, rx: 4, class: "band" });
    tipOn(tip, rect, () => `The pooled A/A band: ${ratioText(band.low)} to ${ratioText(band.high)}, from ${band.cases} A/A cases`);
    root.append(rect);
  }
  const margin = svg("rect", { x: x(Math.exp(-MARGIN)), y: yv + 6, width: x(Math.exp(MARGIN)) - x(Math.exp(-MARGIN)), height: verdictH - 6, rx: 4, class: "margin" });
  root.append(margin);
  // The line at 1 has a part in each row, so it does not cross the labels of the rows.
  for (const [y1, y2] of [[top.candidate, top.candidate + rowH], [top.aa, top.aa + rowH], [yv + 6, axisY]] as const) root.append(svg("line", { x1: x(1), x2: x(1), y1, y2, class: "one" }));
  const truth = x(bench.ratio);
  root.append(svg("path", { d: `M${truth - 6},${yv} L${truth + 6},${yv} L${truth},${yv + 8} Z`, class: "truth" }));
  if (v.interval !== undefined) {
    const iv = v.interval;
    const lo = x(iv.low);
    const hi = x(iv.high);
    const bar = svg("rect", { x: lo, y: mid - 4, width: Math.max(8, hi - lo), height: 8, rx: 4, class: "interval" });
    const dot = svg("circle", { cx: x(iv.estimate), cy: mid, r: 6, class: "estimate" });
    const hit = svg("rect", { x: lo - 8, y: mid - 14, width: Math.max(8, hi - lo) + 16, height: 28, class: "hit" });
    tipOn(tip, hit, () => `The interval of the candidate: ${ratioText(iv.low)} to ${ratioText(iv.high)}, estimate ${ratioText(iv.estimate)}`, bar);
    root.append(bar, dot, hit);
  }
  host.replaceChildren(root);
}

/** This function gives the facts line of the verdict: the margin, the pooled band and the noise cap, from the fields of the verdict. */
export function factsText(v: TimeVerdict): string {
  const parts: string[] = [];
  if (v.band !== undefined) {
    const runs = v.pool?.runs === undefined ? "" : ` of ${v.pool.runs} earlier runs`;
    parts.push(`The same zone is the wider of the margin ${ratioText(Math.exp(-MARGIN))} to ${ratioText(Math.exp(MARGIN))} and the pooled A/A band ${ratioText(v.band.low)} to ${ratioText(v.band.high)} (${v.band.cases} cases${runs}).`);
  }
  if (v.noise !== undefined && v.noise.spread !== undefined) {
    parts.push(`The A/A spread of this run is ${pct(Math.exp(v.noise.spread) - 1)}, and the noise cap is ${pct(Math.exp(v.noise.cap) - 1)}.`);
  }
  return parts.join(" ");
}

/** This function gives the code of the call that the page makes. */
export function callCode(): string {
  return `import { timeVerdict } from "@mark1russell7/rigor-bench";

const v = timeVerdict(candidate, aa, {
  margin: ${MARGIN},
  noiseCap: Math.log(1.2),
  pool: { records: earlierAA, run: (r) => r.case.split(":")[0] },
});
v.outcome; // "faster", "slower", "same" or "cannot decide"`;
}

/** This function writes the records into the table of the page. */
function fillRecords(body: HTMLElement, result: Explored): void {
  body.replaceChildren(...[...result.records.candidate, ...result.records.aa].map(rowOf));
}

function rowOf(r: { case: string; round: number; first: string; a: number; b: number }): HTMLTableRowElement {
  const tr = el("tr");
  for (const text of [r.case, String(r.round), r.first, r.a.toFixed(2), r.b.toFixed(2), ratioText(r.b / r.a)]) tr.append(el("td", {}, text));
  return tr;
}

/** This function shows the result of a power test: the share of each outcome, and the share of the true outcome. */
function showPower(host: HTMLElement, p: Power): void {
  const list = el("ul", { class: "shares" });
  for (const outcome of ["faster", "same", "slower", "cannot decide"] as const) {
    const share = p.outcomes[outcome];
    const li = el("li", { "data-outcome": outcome });
    li.append(el("span", { class: "swatch" }), el("strong", {}, `${Math.round(share * 100)}%`), document.createTextNode(` ${outcome}`));
    list.append(li);
  }
  const line = el("p", { id: "vx-power-line" }, `In ${p.trials} new benches with these settings, the verdict gives the true outcome in ${Math.round(p.power * 100)}% of them.`);
  host.replaceChildren(line, list);
}

export function startExplorer(): void {
  const q = <T extends Element>(s: string): T | null => document.querySelector<T>(s);
  const ratio = q<HTMLInputElement>("#vx-ratio");
  const noise = q<HTMLInputElement>("#vx-noise");
  const seed = q<HTMLInputElement>("#vx-seed");
  const ratioOut = q<HTMLOutputElement>("#vx-ratio-out");
  const noiseOut = q<HTMLOutputElement>("#vx-noise-out");
  const roundsPick = q<HTMLElement>("#vx-rounds");
  const presets = q<HTMLElement>("#vx-presets");
  const badge = q<HTMLElement>("#vx-badge");
  const why = q<HTMLElement>("#vx-why");
  const chart = q<HTMLElement>("#vx-chart");
  const reason = q<HTMLElement>("#vx-reason");
  const facts = q<HTMLElement>("#vx-facts");
  const records = q<HTMLDetailsElement>("#vx-records");
  const recordBody = q<HTMLElement>("#vx-record-rows");
  const count = q<HTMLElement>("#vx-record-count");
  const powerRun = q<HTMLButtonElement>("#vx-power-run");
  const powerOut = q<HTMLElement>("#vx-power");
  const code = q<HTMLElement>("#vx-code");
  const tip = q<HTMLElement>("#tip");
  if (!ratio || !noise || !seed || !ratioOut || !noiseOut || !roundsPick || !presets || !badge || !why || !chart || !reason || !facts || !records || !recordBody || !count || !powerRun || !powerOut || !code || !tip) return;

  let rounds = START.rounds;
  let last: { bench: Bench; result: Explored } | undefined;
  let powerToken = 0;
  code.textContent = callCode();

  for (const n of ROUNDS) {
    const b = el("button", { type: "button", "data-rounds": String(n), "aria-pressed": String(n === rounds) }, String(n));
    b.addEventListener("click", () => {
      rounds = n;
      update();
    });
    roundsPick.append(b);
  }
  for (const p of PRESETS) {
    const b = el("button", { type: "button", "data-preset": p.id }, p.label);
    b.addEventListener("click", () => {
      ratio.value = String(p.bench.ratio);
      noise.value = String(p.bench.noise);
      rounds = p.bench.rounds;
      update(p.id);
    });
    presets.append(b);
  }

  const bench = (): Bench => ({ ratio: Number(ratio.value), noise: Number(noise.value), rounds, seed: seed.value });

  const update = (preset?: string): void => {
    const b = bench();
    for (const button of roundsPick.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset["rounds"] === String(rounds)));
    for (const button of presets.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset["preset"] === preset));
    ratioOut.textContent = `${b.ratio.toFixed(2)} (${changeText(b.ratio)})`;
    noiseOut.textContent = `${Math.round(b.noise * 100)}%`;
    const result = explore(b);
    last = { bench: b, result };
    const v = result.verdict;
    badge.dataset["outcome"] = v.outcome;
    badge.textContent = BADGE[v.outcome];
    why.textContent = plainWhy(v);
    reason.textContent = `The package says: ${v.reason}`;
    facts.textContent = factsText(v);
    drawChart(chart, tip, result, b);
    count.textContent = String(result.records.candidate.length + result.records.aa.length);
    if (records.open) fillRecords(recordBody, result);
    powerToken++;
    powerOut.replaceChildren();
    powerRun.disabled = false;
  };

  ratio.addEventListener("input", () => update());
  noise.addEventListener("input", () => update());
  seed.addEventListener("input", () => update());
  records.addEventListener("toggle", () => {
    if (records.open && last) fillRecords(recordBody, last.result);
  });
  powerRun.addEventListener("click", () => {
    if (!last) return;
    const { bench: b, result } = last;
    const token = ++powerToken;
    const parts: Power[] = [];
    powerRun.disabled = true;
    powerOut.replaceChildren(el("p", { class: "fine" }, "The page draws the benches…"));
    // Five parts of 10 benches each, with a pause between them, so the page stays live.
    const step = (): void => {
      if (token !== powerToken) return;
      parts.push(power(b, result.records, 10, parts.length + 1));
      if (parts.length < 5) {
        powerOut.replaceChildren(el("p", { class: "fine" }, `The page draws the benches: ${parts.length * 10} of 50…`));
        setTimeout(step, 0);
        return;
      }
      showPower(powerOut, mergePower(parts));
      powerRun.disabled = false;
    };
    setTimeout(step, 0);
  });
  new ResizeObserver(() => {
    if (last) drawChart(chart, tip, last.result, last.bench);
  }).observe(chart);
  update();
}

