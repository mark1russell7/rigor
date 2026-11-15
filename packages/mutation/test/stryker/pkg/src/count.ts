// The fixture of the stop check (stop.ts). Each line gives Stryker some mutants.
export function grade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export function total(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += v > 0 ? v : 0;
  return sum;
}
