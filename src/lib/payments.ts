/**
 * Payment provider seam. Checkout talks only to this module, so swapping
 * providers touches nothing else.
 *
 *   PAYMENT_PROVIDER=dummy     (default) test mode, no real charge
 *   PAYMENT_PROVIDER=razorpay  real payments, via RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET
 */
import crypto from "node:crypto";

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

function razorpayAuthHeader(): string {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new HttpError(503, "Online payments are being set up. Please try again shortly.");
  }
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

/** Registers the order with the gateway before the buyer pays. */
export async function createProviderOrder(order: {
  id: string;
  amount: number;
}): Promise<ProviderOrder> {
  if (activeProvider() === "razorpay") {
    const auth = razorpayAuthHeader();
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({
        // Razorpay wants the smallest currency unit (paise); `order.amount`
        // is whole rupees everywhere else in this codebase.
        amount: Math.round(order.amount * 100),
        currency: "INR",
        receipt: order.id,
        payment_capture: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[razorpay] order creation failed (${response.status}):`, body.slice(0, 500));
      throw new HttpError(502, "Couldn't start payment. Please try again.");
    }
    const rzpOrder = (await response.json()) as { id: string };
    return {
      providerOrderId: rzpOrder.id,
      clientData: { key: process.env.RAZORPAY_KEY_ID, orderId: rzpOrder.id },
    };
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
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) throw new HttpError(503, "Online payments are being set up. Please try again shortly.");

    const paymentId = String(payload.razorpay_payment_id ?? "");
    const razorpayOrderId = String(payload.razorpay_order_id ?? "");
    const signature = String(payload.razorpay_signature ?? "");
    // The order id Razorpay's own callback reports must match the one this
    // order was actually created with — not just any signed payment.
    if (!paymentId || !signature || !razorpayOrderId || razorpayOrderId !== order.providerOrderId) {
      throw new HttpError(400, "Payment could not be verified.");
    }

    const expected = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpayOrderId}|${paymentId}`)
      .digest("hex");
    const expectedBuf = Buffer.from(expected, "utf8");
    const signatureBuf = Buffer.from(signature, "utf8");
    const valid =
      expectedBuf.length === signatureBuf.length && crypto.timingSafeEqual(expectedBuf, signatureBuf);
    if (!valid) throw new HttpError(400, "Payment could not be verified.");

    return { providerPaymentId: paymentId };
  }
  void payload;
  return { providerPaymentId: `dummy_pay_${Date.now()}` };
}
