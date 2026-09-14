/**
 * Payment provider seam. Checkout talks only to this module, so swapping the
 * dummy provider for Razorpay touches nothing else.
 *
 *   PAYMENT_PROVIDER=dummy     (default) test mode, no real charge
 *   PAYMENT_PROVIDER=razorpay  real payments — implement the two functions below
 */
import { HttpError } from "./http.js";

export type PaymentProvider = "dummy" | "razorpay";

export function activeProvider(): PaymentProvider {
  return process.env.PAYMENT_PROVIDER === "razorpay" ? "razorpay" : "dummy";
}

export interface ProviderOrder {
  providerOrderId: string;
  /** Anything the browser needs to open the gateway's checkout. */
  clientData: Record<string, unknown>;
}

/** Registers the order with the gateway before the buyer pays. */
export async function createProviderOrder(order: {
  id: string;
  amount: number;
}): Promise<ProviderOrder> {
  if (activeProvider() === "razorpay") {
    // TODO(razorpay): POST https://api.razorpay.com/v1/orders with
    //   { amount: order.amount * 100, currency: "INR", receipt: order.id }
    // and return { providerOrderId: rzpOrder.id, clientData: { key: RAZORPAY_KEY_ID, orderId: rzpOrder.id } }.
    throw new HttpError(503, "Online payments are being set up. Please try again shortly.");
  }
  return { providerOrderId: `dummy_${order.id}`, clientData: { testMode: true } };
}

/**
 * Confirms money actually moved. Returns the gateway payment id, or throws.
 * This is the only place a purchase is allowed to become "paid".
 */
export async function verifyProviderPayment(
  order: { providerOrderId: string },
  payload: Record<string, unknown>,
): Promise<{ providerPaymentId: string }> {
  if (activeProvider() === "razorpay") {
    // TODO(razorpay): verify HMAC-SHA256 of `${order.providerOrderId}|${payload.razorpay_payment_id}`
    // with RAZORPAY_KEY_SECRET against payload.razorpay_signature (timing-safe compare),
    // then return { providerPaymentId: String(payload.razorpay_payment_id) }.
    throw new HttpError(503, "Online payments are being set up. Please try again shortly.");
  }
  void payload;
  return { providerPaymentId: `dummy_pay_${Date.now()}` };
}
