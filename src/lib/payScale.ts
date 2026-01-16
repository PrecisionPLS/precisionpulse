// src/lib/payScale.ts
export function calculateContainerPay(
  piecesTotal: number,
  opts?: { palletized?: boolean }
): number {
  // ✅ Palletized overrides everything
  if (opts?.palletized) return 100;

  if (piecesTotal <= 0) return 0;
  if (piecesTotal <= 500) return 100;
  if (piecesTotal <= 1500) return 130;
  if (piecesTotal <= 3500) return 180;
  if (piecesTotal <= 5500) return 230;
  if (piecesTotal <= 7500) return 280;
  return 280 + 0.05 * (piecesTotal - 7500);
}
