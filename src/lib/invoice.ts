import { nextSeq } from "../models/Counter.js";

export interface GstBreakdown {
  /** What the buyer actually paid — the number shown on the course page. */
  totalAmount: number;
  gstRate: number;
  /** Amount before tax, backed out of the inclusive total. */
  taxableValue: number;
  gstAmount: number;
  /** Split evenly for an intra-state sale; shown alongside the combined amount. */
  cgstAmount: number;
  sgstAmount: number;
}

/**
 * Course prices are GST-inclusive, so the tax is backed out of the total
 * rather than added on top — the buyer never pays more than the listed price.
 * Rounded to paise (2 decimals), same convention any GST invoice uses.
 */
export function gstBreakdown(totalAmount: number, gstRate: number): GstBreakdown {
  const taxableValue = round2((totalAmount * 100) / (100 + gstRate));
  const gstAmount = round2(totalAmount - taxableValue);
  const half = round2(gstAmount / 2);
  return {
    totalAmount,
    gstRate,
    taxableValue,
    gstAmount,
    cgstAmount: half,
    // Whatever paise rounding drops, SGST absorbs it so the two halves sum
    // back exactly to gstAmount.
    sgstAmount: round2(gstAmount - half),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** e.g. "CA2026-00001". Global sequence, year is informational only. */
export async function nextInvoiceNumber(): Promise<string> {
  const seq = await nextSeq("invoice");
  return `CA${new Date().getFullYear()}-${String(seq).padStart(5, "0")}`;
}
