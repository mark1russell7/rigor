/**
 * Test fakes of browser objects, for tests that run in Node. Each fake has no dependency.
 */

/** A listener of a fake event target. */
export type FakeListener = (event?: unknown) => void;

/** The options of `addEventListener`. `true` is the same as `{ capture: true }`. */
export type FakeListenerOptions = boolean | { readonly capture?: boolean; readonly once?: boolean };

/** One listener of a fake event target, with its type and its phase. */
export interface FakeRegistration {
  readonly type: string;
  readonly listener: FakeListener;
  readonly capture: boolean;
  /** True when the target removes the listener after the listener gets one event. */
  readonly once: boolean;
}

/** A fake event target that records its listeners. */
export interface FakeEventTarget {
  /** This method adds a listener. A second addition with the same type, listener and phase does nothing, as in a browser. */
  addEventListener(type: string, listener: FakeListener, options?: FakeListenerOptions): void;
  /** This method removes the listener with the same type, listener and phase. */
  removeEventListener(type: string, listener: FakeListener, options?: boolean | { readonly capture?: boolean }): void;
  /**
   * This method sends the event to the capture listeners first, then to the other listeners, as a browser does at the target.
   * A listener that an earlier listener removes does not get the event. A listener that an earlier listener adds gets the next event.
   */
  dispatch(type: string, event?: unknown): void;
  /** This method gives a copy of the listeners, in the order of their addition. */
  listeners(): FakeRegistration[];
}

const captureOf = (options: FakeListenerOptions | undefined): boolean => (typeof options === "boolean" ? options : options?.capture === true);

/** This function makes a fake event target for a test. */
export function createFakeEventTarget(): FakeEventTarget {
  let listeners: FakeRegistration[] = [];
  const indexOf = (type: string, listener: FakeListener, capture: boolean): number =>
    listeners.findIndex((l) => l.type === type && l.listener === listener && l.capture === capture);
  return {
    addEventListener(type, listener, options) {
      const capture = captureOf(options);
      if (indexOf(type, listener, capture) >= 0) return;
      listeners = [...listeners, { type, listener, capture, once: typeof options === "object" && options.once === true }];
    },
    removeEventListener(type, listener, options) {
      const index = indexOf(type, listener, captureOf(options));
      if (index >= 0) listeners = listeners.filter((_, i) => i !== index);
    },
    dispatch(type, event) {
      const matching = listeners.filter((l) => l.type === type);
      for (const l of [...matching.filter((m) => m.capture), ...matching.filter((m) => !m.capture)]) {
        if (!listeners.includes(l)) continue;
        if (l.once) listeners = listeners.filter((other) => other !== l);
        l.listener(event);
      }
    },
    listeners() {
      return [...listeners];
    },
  };
}
