/**
 * The information of a discrete distribution: its entropy, and the expected information gain of an observation. A
 * diagnosis uses the gain to choose the next test: the test with the largest gain removes the most uncertainty.
 */

/** The largest distance of the sum of a distribution from 1. The products of many rows add their rounding errors. */
const SUM_TOLERANCE = 1e-6;

function distribution(name: string, what: string, values: readonly number[]): void {
  if (values.length === 0) throw new RangeError(`${name}: ${what} has no values.`);
  let sum = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name}: ${what} has the value ${value}. Each value is finite and 0 or more.`);
    sum += value;
  }
  if (Math.abs(sum - 1) > SUM_TOLERANCE) throw new RangeError(`${name}: the sum of ${what} is ${sum}, not 1.`);
}

/**
 * The entropy of a discrete distribution, in bits (Shannon, 1948). The values are the probabilities of the outcomes, and
 * their sum is 1. An outcome with the probability 0 adds nothing. One sure outcome gives 0, and `n` equal outcomes give
 * `log2(n)`.
 */
export function entropy(probabilities: readonly number[]): number {
  distribution("entropy", "the distribution", probabilities);
  let bits = 0;
  for (const p of probabilities) if (p > 0) bits -= p * Math.log2(p);
  return Math.max(0, bits);
}

/**
 * The expected information gain of an observation about a discrete variable, in bits. It is the mutual information
 * `I(H; X)` of the variable `H` and the observation `X` (Lindley, 1956).
 *
 * - `prior[h]` is the probability of the value `h` of the variable before the observation.
 * - `likelihood[h][x]` is the probability of the outcome `x` of the observation when the variable has the value `h`.
 *
 * The gain is the entropy of the prior minus the expected entropy of the posterior. It is 0 when each row of the
 * likelihood is the same, and it is at most the entropy of the prior.
 */
export function informationGain(prior: readonly number[], likelihood: readonly (readonly number[])[]): number {
  distribution("informationGain", "the prior", prior);
  if (likelihood.length !== prior.length) {
    throw new RangeError(`informationGain: the prior has ${prior.length} values and the likelihood has ${likelihood.length} rows.`);
  }
  const outcomes = likelihood[0]?.length ?? 0;
  likelihood.forEach((row, h) => {
    if (row.length !== outcomes) throw new RangeError(`informationGain: the row ${h} of the likelihood has ${row.length} outcomes, not ${outcomes}.`);
    distribution("informationGain", `the row ${h} of the likelihood`, row);
  });
  const marginal = new Array<number>(outcomes).fill(0);
  likelihood.forEach((row, h) => row.forEach((p, x) => (marginal[x] = (marginal[x] ?? 0) + (prior[h] ?? 0) * p)));
  // I(H; X) = sum over h and x of P(h) P(x | h) log2(P(x | h) / P(x)). Each term with P(h) P(x | h) = 0 adds nothing.
  let bits = 0;
  likelihood.forEach((row, h) => {
    const weight = prior[h] ?? 0;
    if (weight === 0) return;
    row.forEach((p, x) => {
      if (p > 0) bits += weight * p * Math.log2(p / (marginal[x] ?? 1));
    });
  });
  return Math.min(Math.max(0, bits), entropy(prior));
}
