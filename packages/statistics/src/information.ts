/**
 * The information of a discrete distribution: its entropy, and the expected information gain of an observation. A
 * diagnosis uses the gain to choose the next test: the test with the largest gain removes the most uncertainty.
 *
 * The expected value of an answer is the general form of the gain (Raiffa and Schlaifer, 1961). A loss gives the cost of
 * each action for each value of the variable. The value of a question starts with the expected loss of the best action
 * before the answer. It subtracts the expected loss of the best action after the answer. With the log loss, this value
 * is the gain.
 */

/** The largest distance of the sum of a distribution from 1. The products of many rows add their rounding errors. */
const SUM_TOLERANCE = 1e-6;

/** This function checks a prior and a likelihood table, and gives the marginal probability of each outcome. */
function marginalOf(name: string, prior: readonly number[], likelihood: readonly (readonly number[])[]): number[] {
  distribution(name, "the prior", prior);
  if (likelihood.length !== prior.length) {
    throw new RangeError(`${name}: the prior has ${prior.length} values and the likelihood has ${likelihood.length} rows.`);
  }
  const outcomes = likelihood[0]?.length ?? 0;
  likelihood.forEach((row, h) => {
    if (row.length !== outcomes) throw new RangeError(`${name}: the row ${h} of the likelihood has ${row.length} outcomes, not ${outcomes}.`);
    distribution(name, `the row ${h} of the likelihood`, row);
  });
  const marginal = new Array<number>(outcomes).fill(0);
  likelihood.forEach((row, h) => row.forEach((p, x) => (marginal[x] = (marginal[x] ?? 0) + (prior[h] ?? 0) * p)));
  return marginal;
}

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
  const marginal = marginalOf("informationGain", prior, likelihood);
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

/**
 * A loss for the expected value of an answer.
 *
 * - `"log"` is the log loss in bits: the action is a distribution `q`, and its loss for the value `h` is `-log2(q[h])`.
 * - A table gives `table[a][h]`: the loss of the action `a` when the variable has the value `h`. Each row has one
 *   finite number for each value. For a plan, the actions are the plans and the loss is their harm.
 */
export type Loss = "log" | readonly (readonly number[])[];

/** This function checks a loss for a variable with `values` values. */
function checkLoss(name: string, loss: Loss, values: number): void {
  if (loss === "log") return;
  if (loss.length === 0) throw new RangeError(`${name}: the loss table has no actions.`);
  loss.forEach((row, a) => {
    if (row.length !== values) throw new RangeError(`${name}: the row ${a} of the loss table has ${row.length} values, not ${values}.`);
    for (const value of row) {
      if (!Number.isFinite(value)) throw new RangeError(`${name}: the row ${a} of the loss table has the value ${value}. Each value is finite.`);
    }
  });
}

/** This function gives the Bayes risk with no checks: the entropy for the log loss, or the smallest expected loss of a row. */
function riskOf(probabilities: readonly number[], loss: Loss): number {
  if (loss === "log") {
    let bits = 0;
    for (const p of probabilities) if (p > 0) bits -= p * Math.log2(p);
    return Math.max(0, bits);
  }
  let best = Number.POSITIVE_INFINITY;
  for (const row of loss) {
    let expected = 0;
    probabilities.forEach((p, h) => {
      if (p > 0) expected += p * (row[h] ?? 0);
    });
    best = Math.min(best, expected);
  }
  return best;
}

/**
 * The Bayes risk of a discrete distribution: the expected loss of the best action (DeGroot, 1970).
 *
 * - With the log loss, the best action is the distribution itself, and the risk is its entropy in bits.
 * - With a loss table, the risk is the smallest expected loss of a row.
 */
export function bayesRisk(probabilities: readonly number[], loss: Loss): number {
  distribution("bayesRisk", "the distribution", probabilities);
  checkLoss("bayesRisk", loss, probabilities.length);
  return riskOf(probabilities, loss);
}

/**
 * The expected value of an answer: the decrease of the Bayes risk that an observation gives, in the unit of the loss.
 *
 * - `prior[h]` and `likelihood[h][x]` have the meaning of `informationGain`.
 * - The value is the Bayes risk of the prior, minus the expected Bayes risk of the posterior over the outcomes.
 * - The value is 0 or more. It is 0 when no outcome changes the best action.
 * - With the log loss, the value is `informationGain(prior, likelihood)`.
 * - With an identity likelihood, the value is the expected value of perfect information.
 */
export function answerValue(prior: readonly number[], likelihood: readonly (readonly number[])[], loss: Loss): number {
  const marginal = marginalOf("answerValue", prior, likelihood);
  checkLoss("answerValue", loss, prior.length);
  let after = 0;
  marginal.forEach((weight, x) => {
    if (weight <= 0) return;
    const posterior = prior.map((p, h) => (p * (likelihood[h]?.[x] ?? 0)) / weight);
    after += weight * riskOf(posterior, loss);
  });
  return Math.max(0, riskOf(prior, loss) - after);
}

/**
 * The actions of an asker that does not take the best action after each answer. An example is a card that shows the
 * first step of a fixed plan for each set of answers. Each action is a row of the loss table.
 */
export interface FixedActions {
  /** The row of the loss table that the asker takes with no answer. */
  readonly before: number;
  /** The row that the asker takes after the answer `x`, one for each answer. */
  readonly after: readonly number[];
}

/**
 * The expected value of an answer for an asker with fixed actions, in the unit of the loss.
 *
 * - `prior[h]` and `likelihood[h][x]` have the meaning of `informationGain`. The loss is a table.
 * - The value is the expected loss of the row `before`, minus the expected loss of the row `after[x]` over the answers.
 * - The asker can keep the row `before` and ignore the answer. Thus a value below 0 gives 0.
 * - When each row `after[x]` is the best row for its posterior, the value is `answerValue`.
 */
export function fixedAnswerValue(prior: readonly number[], likelihood: readonly (readonly number[])[], loss: Loss, fixed: FixedActions): number {
  const name = "fixedAnswerValue";
  const marginal = marginalOf(name, prior, likelihood);
  if (loss === "log") throw new RangeError(`${name}: fixed actions need a loss table. With the log loss, an action is a distribution.`);
  checkLoss(name, loss, prior.length);
  if (fixed.after.length !== marginal.length) throw new RangeError(`${name}: the fixed actions have ${fixed.after.length} rows after an answer, not ${marginal.length}.`);
  for (const row of [fixed.before, ...fixed.after]) {
    if (!Number.isInteger(row) || row < 0 || row >= loss.length) throw new RangeError(`${name}: the fixed action ${row} is not a row of the loss table.`);
  }
  let before = 0;
  let after = 0;
  prior.forEach((p, h) => {
    if (p <= 0) return;
    before += p * (loss[fixed.before]?.[h] ?? 0);
    // P(h and x) = P(h) P(x | h). The asker takes the row after[x] for the answer x.
    likelihood[h]?.forEach((q, x) => {
      if (q > 0) after += p * q * (loss[fixed.after[x] ?? 0]?.[h] ?? 0);
    });
  });
  return Math.max(0, before - after);
}

/** A question that a diagnosis or a plan can ask next, with the likelihood of its answers. */
export interface Question {
  /** The id of the question. */
  readonly id: string;
  /** The probability `likelihood[h][x]` of the answer `x` when the variable has the value `h`. */
  readonly likelihood: readonly (readonly number[])[];
  /** The cost of the question, for example its time in seconds. When two values are equal, the lower cost comes first. The default is 0. */
  readonly cost?: number | undefined;
  /** With fixed actions, the value of the question is `fixedAnswerValue`. With no fixed actions, the value is `answerValue`. */
  readonly fixed?: FixedActions | undefined;
}

/** A question with the expected value of its answer. */
export interface QuestionValue {
  readonly question: Question;
  /** The expected value of the answer, in the unit of the loss. */
  readonly value: number;
}

/** Two values that differ by less than this fraction of the largest value are equal in the order of `rankQuestions`. */
export const VALUE_RESOLUTION = 1e-9;

/**
 * This function gives the questions from the largest expected value of their answers. The first question is the next
 * question to ask.
 *
 * - The list `outcomes` is the prior: the probability of each value of the variable.
 * - The value of each question is `answerValue(outcomes, question.likelihood, loss)`. A question with fixed actions has the
 *   value `fixedAnswerValue(outcomes, question.likelihood, loss, question.fixed)`.
 * - With the log loss, the order is the order of the information gain.
 * - When two values are equal, the lower cost comes first, then the order of the candidates.
 */
export function rankQuestions(candidates: readonly Question[], outcomes: readonly number[], loss: Loss): QuestionValue[] {
  const valueOf = (question: Question): number => (question.fixed === undefined ? answerValue(outcomes, question.likelihood, loss) : fixedAnswerValue(outcomes, question.likelihood, loss, question.fixed));
  const values = candidates.map((question, order) => ({ choice: { question, value: valueOf(question) }, order }));
  const scale = Math.max(0, ...values.map(({ choice }) => choice.value));
  const level = (value: number): number => (scale === 0 ? 0 : Math.round(value / (scale * VALUE_RESOLUTION)));
  return values
    .sort((a, b) => level(b.choice.value) - level(a.choice.value) || (a.choice.question.cost ?? 0) - (b.choice.question.cost ?? 0) || a.order - b.order)
    .map(({ choice }) => choice);
}
