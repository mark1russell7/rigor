/**
 * The probe of the time-verdict explorer. The site check of the Pages workflow starts it in a browser at each width,
 * before the deploy. A failed check stops the deploy.
 *
 * The site check reads the probe as the body of an async function. The build of the site removes the types and the
 * `export` line, and it writes the result to `dist/check-probe.js` (`src/build.ts`).
 */

// The site check gives these helpers to the probe.
declare const check: (name: string, ok: unknown, detail?: unknown) => boolean;
declare const until: <T>(fn: () => T | Promise<T>, ms?: number) => Promise<T>;
declare const $: (selector: string) => Element | null;
declare const $$: (selector: string) => Element[];
declare const type: (target: string | Element, text: string) => void;
declare const click: (target: string | Element) => void;

const outcome = (): string => (($("#vx-badge") as HTMLElement | null)?.dataset["outcome"] ?? "");
const badge = (): string => $("#vx-badge")?.textContent ?? "";
const width = (selector: string): number => $(selector)?.getBoundingClientRect().width ?? 0;
const records = (): number => $$("#vx-chart .rec").length;
const LABEL: Record<string, RegExp> = { faster: /Faster/, slower: /Slower/, same: /Same/, "cannot decide": /Cannot decide/ };
const preset = async (id: string, expected: string): Promise<void> => {
  click(`#vx-presets [data-preset="${id}"]`);
  check(`the preset ${id} gives the verdict ${expected}`, await until(() => outcome() === expected), outcome());
  check(`the badge of the preset ${id} says ${expected}`, LABEL[expected]?.test(badge()), badge());
};

// The page script draws the explorer when it starts. Wait for the whole first draw before the first check.
check("the explorer shows a verdict when the page opens", await until(() => outcome() !== "" && records() > 0 && $("#vx-presets button") !== null, 10000), badge());
check("the same zone draws", await until(() => width("#vx-chart .zone") > 0), width("#vx-chart .zone"));
check("the pooled A/A band draws", width("#vx-chart .band") > 0, width("#vx-chart .band"));
check("the interval of the candidate draws", width("#vx-chart .interval") > 0, width("#vx-chart .interval"));
check("the line at 1 draws", $("#vx-chart .one") !== null);
check("the diagram shows each record of the two pairs (2 x 8 cases x 9 rounds)", records() === 144, records());

const first = badge();
await preset("noisy", "cannot decide");
check("the badge changes when the verdict changes", badge() !== first, `${first} -> ${badge()}`);
await preset("faster", "faster");
await preset("same", "same");
await preset("slower", "slower");

click('#vx-presets [data-preset="faster"]');
await until(() => outcome() === "faster");
type("#vx-ratio", "1.2");
check("the slider at 1.2 gives the verdict slower", await until(() => outcome() === "slower"), outcome());
check("the output of the slider shows the change", /20% slower/.test($("#vx-ratio-out")?.textContent ?? ""), $("#vx-ratio-out")?.textContent);

click('#vx-rounds [data-rounds="31"]');
check("31 rounds give 496 records", await until(() => records() === 496), records());

const reason = $("#vx-reason")?.textContent ?? "";
type("#vx-seed", "7");
check("a new seed gives new records", await until(() => ($("#vx-reason")?.textContent ?? "") !== reason), reason);

click("#vx-records summary");
check("the table shows each record", await until(() => $$("#vx-record-rows tr").length === 496), $$("#vx-record-rows tr").length);

click("#vx-power-run");
const line = (): string => $("#vx-power-line")?.textContent ?? "";
check("the power test gives the share of the true outcome", await until(() => /in \d+% of them/.test(line()), 30_000), line());
check("the power test shows the four outcomes", $$("#vx-power .shares li").length === 4, $$("#vx-power .shares li").length);

export {};
