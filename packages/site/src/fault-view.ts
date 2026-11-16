/**
 * The DOM part of the fault-plan demo, for a browser only. It reads the controls, uses `runDemo`, and draws each
 * direction of each connection: the frames that reach the proxy, the writes of the proxy, and the faults between them.
 */
import { type FaultKind, FAULT_KINDS } from "@mark1russell7/rigor-chaos";
import type { FaultRecord } from "@mark1russell7/rigor-proxy/applier";
import {
  type DemoConnection,
  type DemoFrame,
  type DemoLane,
  type DemoRun,
  type DirectionChoice,
  type FaultDemo,
  CONNECTION_CHOICES,
  DEMO_START,
  DIRECTION_CHOICES,
  FAULT_CHOICES,
  FRAME_BYTES,
  KIND_TEXT,
  RECORD_HEADS,
  demoCode,
  demoCounts,
  faultText,
  frameOutcome,
  pointText,
  runDemo,
  summaryText,
} from "./fault-demo.ts";

const SVG = "http://www.w3.org/2000/svg";

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

/** The tooltip of the page: one element that follows the pointer. */
function tipOn(tip: HTMLElement, target: SVGElement, text: () => string, mark?: SVGElement): void {
  target.addEventListener("pointermove", (ev: PointerEvent) => {
    tip.hidden = false;
    tip.textContent = text();
    const x = Math.min(ev.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${ev.clientY + 14}px`;
    mark?.classList.add("on");
  });
  target.addEventListener("pointerleave", () => {
    tip.hidden = true;
    mark?.classList.remove("on");
  });
}

const LANE_TEXT = { up: "up: client to server", down: "down: server to client" } as const;
const ms = (t: number): string => `${Math.round(t)} ms`;

/** This function gives the text of the tooltip of a frame: its arrival, its read and its writes. */
function frameTip(lane: DemoLane, frame: DemoFrame): string {
  const head = `${lane.direction} frame ${frame.index}: arrives at ${ms(frame.arrives)}`;
  if (frame.read === undefined) return `${head}. The connection closed first, so the proxy does not read it.`;
  const read = frame.read === frame.arrives ? "" : `, read at ${ms(frame.read)}`;
  if (frame.writes.length === 0) return `${head}${read}. No byte of it goes out.`;
  const writes = frame.writes.map((w) => `${w.bytes} bytes at ${ms(w.at)}${w.lost ? " (lost)" : ""}`).join(", ");
  return `${head}${read}. Writes: ${writes}.`;
}

/** This function gives the text of the tooltip of a fault record. */
function recordTip(run: DemoRun, record: FaultRecord): string {
  const fault = run.plan.faults[record.index];
  const what = fault === undefined ? record.kind : `${record.kind} (${faultText(fault)})`;
  return `Fault ${record.index}: ${what}, at frame ${record.frame}, ${ms(record.at)}`;
}

/** The heights of the parts of the diagram. */
const H = { head: 20, label: 16, flags: 16, gap: 30, after: 12, axis: 26 } as const;

/** This function draws the diagram: for each connection, its two directions, and the axis of time. */
function drawChart(host: HTMLElement, tip: HTMLElement, run: DemoRun): void {
  const W = Math.max(280, Math.round(host.clientWidth));
  const pad = { l: 12, r: 14 };
  const inner = W - pad.l - pad.r;
  const end = Math.ceil(run.end / 100) * 100;
  const x = (t: number): number => pad.l + (Math.min(t, end) / end) * inner;
  const laneH = H.label + H.flags + H.gap + H.after;
  const blockH = H.head + 2 * laneH;
  const height = run.connections.length * blockH + H.axis;
  const root = svg("svg", { width: W, height, viewBox: `0 0 ${W} ${height}`, role: "img", "aria-label": `The frames of ${run.connections.length} connections, the writes of the proxy and the faults of the plan.` });

  run.connections.forEach((c, ci) => {
    const top = ci * blockH;
    const closeText = c.close === undefined ? "ends with each stream" : `${c.close.kind} at ${ms(c.close.at)}`;
    root.append(svg("text", { x: pad.l, y: top + 14, class: "fx-head" }, `Connection ${c.connection}: ${closeText}`));
    c.lanes.forEach((lane, li) => drawLane(root, tip, run, c, lane, top + H.head + li * laneH, x));
    if (c.close !== undefined) {
      const at = x(c.close.at);
      const line = svg("line", { x1: at, x2: at, y1: top + H.head, y2: top + blockH - H.after, class: `fx-close ${c.close.kind}` });
      const hit = svg("rect", { x: at - 6, y: top + H.head, width: 12, height: blockH - H.head - H.after, class: "hit" });
      const close = c.close;
      tipOn(tip, hit, () => `The ${close.kind} of the ${close.direction} direction closes the connection at ${ms(close.at)}. No frame after it goes through.`, line);
      root.append(line, hit);
    }
  });

  // The axis of time, with a tick each 100, 200 or 500 ms, so the labels do not touch.
  const axisY = height - H.axis + 6;
  root.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: axisY, y2: axisY, class: "axis" }));
  const step = [100, 200, 500, 1000].find((s) => (s / end) * inner >= 46) ?? 1000;
  for (let t = 0; t <= end; t += step) {
    root.append(svg("line", { x1: x(t), x2: x(t), y1: axisY, y2: axisY + 4, class: "axis" }));
    const anchor = t === 0 ? "start" : t + step > end ? "end" : "middle";
    root.append(svg("text", { x: x(t), y: axisY + 17, class: "tick", "text-anchor": anchor }, t === 0 ? "0 ms" : `${t}`));
  }
  host.replaceChildren(root);
}

/** This function draws one direction: the rail of the reads, the rail of the writes, a line from each frame to each of its writes, and the faults. */
function drawLane(root: SVGElement, tip: HTMLElement, run: DemoRun, c: DemoConnection, lane: DemoLane, top: number, x: (t: number) => number): void {
  const yIn = top + H.label + H.flags;
  const yOut = yIn + H.gap;
  const g = svg("g", { class: "fx-lane", "data-direction": lane.direction });
  root.append(g);
  g.append(svg("text", { x: x(0), y: top + 12, class: "row-label" }, LANE_TEXT[lane.direction]));
  g.append(svg("line", { x1: x(0), x2: x(run.end), y1: yIn, y2: yIn, class: "fx-rail" }));
  g.append(svg("line", { x1: x(0), x2: x(run.end), y1: yOut, y2: yOut, class: "fx-rail" }));

  // The bands: a stall on the rail of the reads, a delay and a hold of a reorder on the rail of the writes.
  for (const pause of lane.pauses) {
    const band = svg("rect", { x: x(pause.from), y: yIn - 5, width: Math.max(2, x(pause.until) - x(pause.from)), height: 10, rx: 3, class: "fx-pause" });
    tipOn(tip, band, () => `stall: the proxy reads nothing from ${ms(pause.from)} to ${ms(pause.until)}`);
    g.append(band);
  }
  const mine = c.records.filter((r) => r.direction === lane.direction);
  for (const record of mine) {
    const fault = run.plan.faults[record.index];
    const span = fault?.kind === "delay" ? fault.forMs : fault?.kind === "reorder" ? fault.holdMs : undefined;
    if (span === undefined) continue;
    const band = svg("rect", { x: x(record.at), y: yOut - 5, width: Math.max(2, x(record.at + span) - x(record.at)), height: 10, rx: 3, class: fault?.kind === "delay" ? "fx-delay" : "fx-hold" });
    tipOn(tip, band, () => recordTip(run, record));
    g.append(band);
  }

  // A line from each frame to each of its writes. A frame waits on the rail of the reads until its read.
  for (const frame of lane.frames) {
    const outcome = frameOutcome(frame);
    if (frame.read !== undefined && frame.read > frame.arrives) g.append(svg("line", { x1: x(frame.arrives), x2: x(frame.read), y1: yIn, y2: yIn, class: "fx-wait" }));
    for (const write of frame.writes) {
      g.append(svg("line", { x1: x(frame.read ?? frame.arrives), y1: yIn + 3, x2: x(write.at), y2: yOut - 4, class: `fx-flow ${write.lost ? "lost" : outcome}` }));
    }
  }
  for (const write of lane.writes) {
    const w = Math.max(2, (write.bytes / FRAME_BYTES) * 6);
    g.append(svg("rect", { x: x(write.at) - w / 2, y: yOut - 4, width: w, height: 8, rx: 1, class: `fx-write${write.lost ? " lost" : ""}` }));
  }
  for (const frame of lane.frames) {
    const outcome = frameOutcome(frame);
    const cx = x(frame.arrives);
    const mark = outcome === "lost" ? svg("path", { d: `M${cx - 4},${yIn - 4}L${cx + 4},${yIn + 4}M${cx - 4},${yIn + 4}L${cx + 4},${yIn - 4}`, class: "fx-frame lost" }) : svg("rect", { x: cx - 4, y: yIn - 4, width: 8, height: 8, rx: 2, class: `fx-frame ${outcome}` });
    const hit = svg("circle", { cx, cy: yIn, r: 9, class: "hit" });
    tipOn(tip, hit, () => frameTip(lane, frame), mark);
    g.append(mark, hit);
  }

  // A flag for each fault, above the rail of the reads. A flag near the flag before it moves up, so the names do not touch.
  let lastX = Number.NEGATIVE_INFINITY;
  let raised = false;
  for (const record of [...mine].sort((a, b) => a.at - b.at)) {
    const fx = x(record.at);
    raised = fx - lastX < 52 ? !raised : false;
    lastX = fx;
    const fy = yIn - 8 - (raised ? 9 : 0);
    const flag = svg("path", { d: `M${fx},${yIn - 6}L${fx},${fy - 6}`, class: `fx-flag ${record.kind}` });
    const name = svg("text", { x: fx + 3, y: fy - 1, class: `fx-fault ${record.kind}` }, record.kind);
    const hit = svg("rect", { x: fx - 4, y: fy - 12, width: 48, height: 16, class: "hit" });
    tipOn(tip, hit, () => recordTip(run, record), name);
    g.append(flag, name, hit);
  }
}

/** This function writes the faults of the plan into the table: each record, and each fault that did not occur. */
function fillRecords(body: HTMLElement, run: DemoRun): void {
  const rows: HTMLTableRowElement[] = [];
  for (const c of run.connections) {
    const records = new Map(c.records.map((r) => [r.index, r]));
    const indexes = [...new Set([...c.records.map((r) => r.index), ...c.pending.map((p) => p.index)])].sort((a, b) => a - b);
    for (const index of indexes) {
      const fault = run.plan.faults[index];
      if (fault === undefined) continue;
      const record = records.get(index);
      const tr = el("tr", record === undefined ? { class: "fx-pending" } : {});
      const cells = [String(index), String(c.connection), fault.direction, fault.kind, pointText(fault), faultText(fault), record === undefined ? "did not occur" : String(Math.round(record.at)), record === undefined ? "" : String(record.bytes)];
      cells.forEach((text, i) => tr.append(el("td", { "data-label": RECORD_HEADS[i] ?? "" }, text)));
      rows.push(tr);
    }
  }
  body.replaceChildren(...rows);
}

/** This function shows the counts as four numbers. */
function showCounts(host: HTMLElement, run: DemoRun): void {
  const counts = demoCounts(run);
  const items: [string, number, string][] = [
    ["faults", counts.occurred, `of ${counts.faults} faults occurred`],
    ["same", counts.same, "frames with no change"],
    ["changed", counts.changed, "frames changed"],
    ["lost", counts.lost, "frames did not go through"],
  ];
  host.replaceChildren(
    ...items.map(([key, n, text]) => {
      const li = el("li", { "data-count": key });
      li.append(el("strong", {}, String(n)), document.createTextNode(` ${text}`));
      return li;
    }),
  );
}

export function startFaultDemo(): void {
  const q = <T extends Element>(s: string): T | null => document.querySelector<T>(s);
  const connectionsPick = q<HTMLElement>("#fx-connections");
  const faultsPick = q<HTMLElement>("#fx-faults");
  const directionsPick = q<HTMLElement>("#fx-directions");
  const kindsPick = q<HTMLElement>("#fx-kinds");
  const seed = q<HTMLInputElement>("#fx-seed");
  const nextSeed = q<HTMLButtonElement>("#fx-next");
  const counts = q<HTMLElement>("#fx-counts");
  const summary = q<HTMLElement>("#fx-summary");
  const chart = q<HTMLElement>("#fx-chart");
  const recordsBox = q<HTMLDetailsElement>("#fx-records");
  const recordRows = q<HTMLElement>("#fx-record-rows");
  const recordCount = q<HTMLElement>("#fx-record-count");
  const planText = q<HTMLElement>("#fx-plan");
  const code = q<HTMLElement>("#fx-code");
  const tip = q<HTMLElement>("#tip");
  if (!connectionsPick || !faultsPick || !directionsPick || !kindsPick || !seed || !nextSeed || !counts || !summary || !chart || !recordsBox || !recordRows || !recordCount || !planText || !code || !tip) return;

  let demo: FaultDemo = { ...DEMO_START, seed: seed.value };
  let last: DemoRun | undefined;

  const chips = <T extends string | number>(host: HTMLElement, key: string, values: readonly T[], label: (v: T) => string, pick: (v: T) => void): void => {
    for (const v of values) {
      const b = el("button", { type: "button", [`data-${key}`]: String(v) }, label(v));
      b.addEventListener("click", () => pick(v));
      host.append(b);
    }
  };
  chips(connectionsPick, "connections", CONNECTION_CHOICES, String, (n) => update({ connections: n }));
  chips(faultsPick, "faults", FAULT_CHOICES, String, (n) => update({ perConnection: n }));
  chips<DirectionChoice>(directionsPick, "directions", DIRECTION_CHOICES, (d) => d, (d) => update({ directions: d }));
  chips<FaultKind>(kindsPick, "kind", FAULT_KINDS, (k) => k, (k) => {
    const on = demo.kinds.includes(k);
    // At least one kind stays on, because a spec needs one kind with a weight.
    if (on && demo.kinds.length === 1) return;
    update({ kinds: FAULT_KINDS.filter((other) => (other === k ? !on : demo.kinds.includes(other))) });
  });
  for (const b of kindsPick.querySelectorAll<HTMLButtonElement>("button")) b.title = KIND_TEXT[b.dataset["kind"] as FaultKind];

  const press = (host: HTMLElement, key: string, on: (value: string) => boolean): void => {
    for (const b of host.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(on(b.dataset[key] ?? "")));
  };

  const update = (change: Partial<FaultDemo> = {}): void => {
    demo = { ...demo, ...change, seed: seed.value };
    press(connectionsPick, "connections", (v) => v === String(demo.connections));
    press(faultsPick, "faults", (v) => v === String(demo.perConnection));
    press(directionsPick, "directions", (v) => v === demo.directions);
    press(kindsPick, "kind", (v) => demo.kinds.includes(v as FaultKind));
    const run = runDemo(demo);
    last = run;
    showCounts(counts, run);
    summary.textContent = summaryText(demoCounts(run));
    drawChart(chart, tip, run);
    recordCount.textContent = String(run.plan.faults.length);
    if (recordsBox.open) fillRecords(recordRows, run);
    planText.textContent = JSON.stringify(run.plan, null, 2);
    code.textContent = demoCode(demo);
  };

  seed.addEventListener("input", () => update());
  nextSeed.addEventListener("click", () => {
    const n = Number(seed.value.trim());
    seed.value = Number.isSafeInteger(n) ? String(n + 1) : "1";
    update();
  });
  recordsBox.addEventListener("toggle", () => {
    if (recordsBox.open && last) fillRecords(recordRows, last);
  });
  new ResizeObserver(() => {
    if (last) drawChart(chart, tip, last);
  }).observe(chart);
  update();
}
