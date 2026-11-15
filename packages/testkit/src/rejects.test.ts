import { describe, expect, it } from "vitest";
import { rejects } from "./rejects.ts";

describe("rejects", () => {
  it("gives the reason of a rejected promise", async () => {
    const reason = new Error("closed");
    await expect(rejects(() => Promise.reject(reason), "get after close")).resolves.toBe(reason);
    await expect(rejects(async () => Promise.reject(3), "a value as reason")).resolves.toBe(3);
  });

  it("accepts a thenable that rejects", async () => {
    const thenable: PromiseLike<never> = { then: (_ok, fail) => Promise.resolve().then(() => fail?.("no")) as never };
    await expect(rejects(() => thenable, "a thenable")).resolves.toBe("no");
  });

  it("fails when the operation throws at once, and keeps the error as the cause", async () => {
    const thrown = new Error("bad id");
    const throwsAtOnce = (): Promise<void> => {
      throw thrown;
    };
    const failure = (await rejects(throwsAtOnce, "put").catch((error: unknown) => error)) as Error;
    expect(failure.message).toBe("put: the operation threw at once (bad id), and did not give a rejected promise");
    expect(failure.cause).toBe(thrown);
  });

  it("fails when the operation gives a value that is not a promise", async () => {
    await expect(rejects(() => 3 as unknown as Promise<number>, "size")).rejects.toThrow(/^size: the operation did not give a promise$/);
    await expect(rejects(() => undefined as unknown as Promise<void>, "flush")).rejects.toThrow(/^flush: the operation did not give a promise$/);
  });

  it("fails when the promise resolves", async () => {
    await expect(rejects(() => Promise.resolve(1), "get of a missing id")).rejects.toThrow(/^get of a missing id: the promise did not reject$/);
  });
});
