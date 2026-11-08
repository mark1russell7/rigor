// The fixture of the stop check (stop.sh). Each line gives Stryker some mutants.
export function grade(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

export function total(values) {
  let sum = 0;
  for (const v of values) sum += v > 0 ? v : 0;
  return sum;
}
