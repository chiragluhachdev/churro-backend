/**
 * Razorpay Subscriptions, for Churro AI's auto-renewing pass. The buyer
 * approves a mandate once (UPI Autopay or card); Razorpay then charges them
 * every period on its own and tells us through the webhook.
 *
 * Follows PAYMENT_PROVIDER like one-time payments: "dummy" fakes a
 * subscription that never renews, so the flow can be clicked through locally.
 */
import crypto from "node:crypto";

import { HttpError } from "./http.js";
import { activeProvider } from "./payments.js";
import { AiSettings } from "../models/AiSettings.js";

/** A monthly mandate for 10 years — Razorpay needs an end, and this is "until cancelled" in practice. */
const MAX_CYCLES = { monthly: 120, yearly: 10 } as const;

export interface RazorpaySubscription {
  id: string;
  plan_id: string;
  status: string;
  /** Unix seconds. */
  current_start?: number | null;
  current_end?: number | null;
  charge_at?: number | null;
  paid_count?: number;
  short_url?: string;
  notes?: Record<string, string>;
}

function authHeader(): string {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new HttpError(503, "Online payments are being set up. Please try again shortly.");
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

async function razorpay<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", Authorization: authHeader() },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`[razorpay] ${init?.method ?? "GET"} ${path} failed (${response.status}):`, body.slice(0, 500));
    // Most often: Subscriptions isn't activated on the Razorpay account yet.
    throw new HttpError(502, "Auto-renewal isn't available right now. Please choose “Pay once” instead.");
  }
  return (await response.json()) as T;
}

/** 365 → yearly ×1, 730 → yearly ×2, 30 → monthly ×1, 90 → monthly ×3. Anything else rounds to whole months. */
export function billingPeriod(days: number): { period: "monthly" | "yearly"; interval: number } {
  if (days % 365 === 0) return { period: "yearly", interval: days / 365 };
  return { period: "monthly", interval: Math.max(1, Math.round(days / 30)) };
}

/**
 * The plan for today's price and length, made on first use. Plans can't be
 * edited in Razorpay, so a price change makes a new one; anyone already
 * subscribed stays on the price they signed up at.
 */
async function currentPlanId(config: { passName: string; passPrice: number; passDays: number }): Promise<string> {
  const key = `${config.passPrice}:${config.passDays}`;
  const settings = await AiSettings.findOne({ key: "ai" }).lean();
  if (settings?.razorpayPlanId && settings.razorpayPlanKey === key) return settings.razorpayPlanId;

  const { period, interval } = billingPeriod(config.passDays);
  const plan = await razorpay<{ id: string }>("/plans", {
    method: "POST",
    body: {
      period,
      interval,
      item: {
        name: config.passName,
        amount: Math.round(config.passPrice * 100),
        currency: "INR",
        description: "Churro AI, renews automatically",
      },
    },
  });
  await AiSettings.updateOne(
    { key: "ai" },
    { $set: { razorpayPlanId: plan.id, razorpayPlanKey: key }, $setOnInsert: { key: "ai" } },
    { upsert: true },
  );
  return plan.id;
}

export async function createSubscription(
  config: { passName: string; passPrice: number; passDays: number },
  memberId: string,
  isInternational: boolean = false,
): Promise<RazorpaySubscription> {
  const effectiveConfig = isInternational ? { ...config, passPrice: config.passPrice * 2 } : config;
  if (activeProvider() !== "razorpay") {
    return { id: `dummy_sub_${memberId}_${Date.now()}`, plan_id: "dummy_plan", status: "created" };
  }
  const planId = await currentPlanId(effectiveConfig);
  return razorpay<RazorpaySubscription>("/subscriptions", {
    method: "POST",
    body: {
      plan_id: planId,
      total_count: MAX_CYCLES[billingPeriod(config.passDays).period],
      quantity: 1,
      // Razorpay emails the buyer before each charge and about mandate changes.
      customer_notify: 1,
      notes: { memberId, product: "churro-ai-pass" },
    },
  });
}

export async function fetchSubscription(id: string): Promise<RazorpaySubscription> {
  if (activeProvider() !== "razorpay") return { id, plan_id: "dummy_plan", status: "active" };
  return razorpay<RazorpaySubscription>(`/subscriptions/${encodeURIComponent(id)}`);
}

/**
 * Stops future charges. `atCycleEnd` keeps the period they've paid for;
 * otherwise it ends now (used when the admin removes access).
 */
export async function cancelSubscription(id: string, atCycleEnd: boolean): Promise<void> {
  if (activeProvider() !== "razorpay" || id.startsWith("dummy_")) return;
  await razorpay(`/subscriptions/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: { cancel_at_cycle_end: atCycleEnd ? 1 : 0 },
  });
}

/** Checkout's success callback for a subscription is signed over `payment_id|subscription_id`. */
export function verifySubscriptionPayment(payload: Record<string, unknown>, subscriptionId: string): string {
  if (activeProvider() !== "razorpay") return `dummy_pay_${subscriptionId}`;

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) throw new HttpError(503, "Online payments are being set up. Please try again shortly.");
  const paymentId = String(payload.razorpay_payment_id ?? "");
  const signedSubscriptionId = String(payload.razorpay_subscription_id ?? "");
  const signature = String(payload.razorpay_signature ?? "");
  if (!paymentId || !signature || signedSubscriptionId !== subscriptionId) {
    throw new HttpError(400, "Payment could not be verified.");
  }
  const expected = Buffer.from(
    crypto.createHmac("sha256", keySecret).update(`${paymentId}|${subscriptionId}`).digest("hex"),
    "utf8",
  );
  const given = Buffer.from(signature, "utf8");
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    throw new HttpError(400, "Payment could not be verified.");
  }
  return paymentId;
}

export const fromUnix = (seconds?: number | null) => (seconds ? new Date(seconds * 1000) : undefined);
