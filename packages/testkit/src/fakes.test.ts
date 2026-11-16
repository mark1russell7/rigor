import { describe, expect, it } from "vitest";
import { createFakeEventTarget } from "./fakes.ts";

describe("createFakeEventTarget", () => {
  it("sends an event to the capture listeners first, each phase in the order of addition", () => {
    const target = createFakeEventTarget();
    const calls: string[] = [];
    target.addEventListener("pagehide", () => calls.push("bubble 1"));
    target.addEventListener("pagehide", () => calls.push("capture 1"), { capture: true });
    target.addEventListener("pagehide", () => calls.push("bubble 2"));
    target.addEventListener("pagehide", () => calls.push("capture 2"), true);
    target.addEventListener("other", () => calls.push("other"));
    target.dispatch("pagehide", { persisted: true });
    expect(calls).toEqual(["capture 1", "capture 2", "bubble 1", "bubble 2"]);
  });

  it("gives the event to each listener", () => {
    const target = createFakeEventTarget();
    const events: unknown[] = [];
    target.addEventListener("visibilitychange", (event) => events.push(event));
    target.dispatch("visibilitychange", { state: "hidden" });
    target.dispatch("visibilitychange");
    expect(events).toEqual([{ state: "hidden" }, undefined]);
  });

  it("removes only the listener with the same type, listener and phase", () => {
    const target = createFakeEventTarget();
    const listener = (): void => undefined;
    target.addEventListener("freeze", listener, { capture: true });
    target.addEventListener("freeze", listener);
    target.removeEventListener("resume", listener);
    target.removeEventListener("freeze", listener, false);
    expect(target.listeners().map((l) => [l.type, l.capture])).toEqual([["freeze", true]]);
    target.removeEventListener("freeze", listener, { capture: true });
    expect(target.listeners()).toEqual([]);
  });

  it("does nothing on a second addition of the same listener in the same phase, as a browser does", () => {
    const target = createFakeEventTarget();
    let calls = 0;
    const listener = (): void => {
      calls += 1;
    };
    target.addEventListener("load", listener);
    target.addEventListener("load", listener, { capture: false });
    target.addEventListener("load", listener, true);
    target.dispatch("load");
    expect(calls).toBe(2);
    expect(target.listeners()).toHaveLength(2);
  });

  it("removes a listener with once after its first call", () => {
    const target = createFakeEventTarget();
    let calls = 0;
    target.addEventListener("pageshow", () => (calls += 1), { once: true });
    expect(target.listeners()[0]?.once).toBe(true);
    target.dispatch("pageshow");
    target.dispatch("pageshow");
    expect(calls).toBe(1);
    expect(target.listeners()).toEqual([]);
  });

  it("does not call a listener that an earlier listener removes, nor one that it adds, in the same dispatch", () => {
    const target = createFakeEventTarget();
    const calls: string[] = [];
    const late = (): void => {
      calls.push("late");
    };
    const removed = (): void => {
      calls.push("removed");
    };
    target.addEventListener("blur", () => {
      calls.push("first");
      target.removeEventListener("blur", removed);
      target.addEventListener("blur", late);
    });
    target.addEventListener("blur", removed);
    target.dispatch("blur");
    expect(calls).toEqual(["first"]);
    target.dispatch("blur");
    expect(calls).toEqual(["first", "first", "late"]);
  });

  it("gives a copy of the listeners", () => {
    const target = createFakeEventTarget();
    target.addEventListener("focus", () => undefined);
    const copy = target.listeners();
    copy.pop();
    expect(target.listeners()).toHaveLength(1);
  });
});
