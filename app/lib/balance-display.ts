/**
 * How a raw lease balance (charges − payments) is shown to a human, app-wide.
 * The underlying number stays "positive = owed" everywhere in the code — this
 * only flips it for display, so what's owed reads as a negative figure in red
 * (money leaving the tenant's side) and a credit reads as a positive figure in
 * green (money sitting in the tenant's favor) — never touch the raw value
 * used for allocation, payment defaults, or alert thresholds.
 */
export function displayBalance(balance: number): number {
  return -balance;
}

export function balanceTone(balance: number): string {
  if (balance > 0) return "text-red-600";
  if (balance < 0) return "text-green-700";
  return "";
}
