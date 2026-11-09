/**
 * A check for an asynchronous operation that must fail. `assert.rejects` of `node:assert` passes when the operation
 * throws at once, and it does not give the error. This check fails in that case, and it gives the error.
 */

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * This function starts an operation that must give a rejected promise, and gives the reason of the rejection. Use it
 * for an API whose methods always give a promise, also for a failure.
 *
 * The check fails with an `Error` whose message starts with `what` in these conditions:
 *
 * - `start` throws at once, before it gives a promise.
 * - `start` gives a value that is not a promise.
 * - The promise resolves.
 *
 * @param start - the function that starts the operation
 * @param what - the name of the operation, for the message of a failure
 */
export async function rejects(start: () => PromiseLike<unknown>, what: string): Promise<unknown> {
  let promise: PromiseLike<unknown>;
  try {
    promise = start();
  } catch (error) {
    throw new Error(`${what}: the operation threw at once (${message(error)}), and did not give a rejected promise`, { cause: error });
  }
  if (typeof (promise as { then?: unknown } | null | undefined)?.then !== "function") {
    throw new Error(`${what}: the operation did not give a promise`);
  }
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error(`${what}: the promise did not reject`);
}
