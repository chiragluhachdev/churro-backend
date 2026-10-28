import { getAiConfig } from "./aiAccess.js";
import { fulfillPaidOrder } from "./fulfillment.js";
import { nextInvoiceNumber } from "./invoice.js";
import { activeProvider } from "./payments.js";
import { fromUnix, type RazorpaySubscription } from "./subscriptions.js";
import { AiMember } from "../models/AiMember.js";
import { Order } from "../models/Order.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long access carries on after a renewal payment fails, while Razorpay retries it. */
export const GRACE_DAYS = 3;

const lengthLabel = (days: number) =>
  days % 365 === 0 ? `${days / 365} year${days === 365 ? "" : "s"}` : `${days} days`;

/**
 * Books one auto-renewal charge: a paid order (so it has a GST invoice, an
 * email and a line in Billing) and the pass running to the end of the period
 * it paid for. Both the buyer's confirm and the webhook call this for the
 * first charge; the unique payment id makes the second call a no-op.
 */
export async function recordSubscriptionCharge(input: {
  memberId: string;
  subscriptionId: string;
  paymentId: string;
  /** Whole rupees. */
  amount: number;
  periodEnd?: Date;
  nextChargeAt?: Date;
  status?: string;
}): Promise<void> {
  if (await Order.exists({ providerPaymentId: input.paymentId })) return;
  const member = await AiMember.findById(input.memberId);
  if (!member) {
    console.error(`[renewal] charge ${input.paymentId} for unknown member ${input.memberId}`);
    return;
  }
  const config = await getAiConfig();
  const now = new Date();

  let order;
  try {
    order = await Order.create({
      kind: "ai_pass",
      aiMember: member._id,
      buyerName: member.name || member.email,
      buyerEmail: member.invoiceEmail || member.email,
      buyerPhone: member.phone ?? "",
      courseTitle: `${config.passName} (${lengthLabel(config.passDays)}, auto-renewing)`,
      amount: input.amount,
      listPrice: input.amount,
      passDays: config.passDays,
      provider: activeProvider(),
      providerPaymentId: input.paymentId,
      subscriptionId: input.subscriptionId,
      periodEnd: input.periodEnd ?? new Date(now.getTime() + config.passDays * DAY_MS),
      status: "paid",
      paidAt: now,
      expiresAt: now,
      invoiceNumber: await nextInvoiceNumber(),
    });
  } catch (error) {
    // Lost a race with the other caller for this same payment — already booked.
    if ((error as { code?: number }).code === 11000) return;
    throw error;
  }

  await AiMember.updateOne(
    { _id: member._id, subscriptionId: input.subscriptionId },
    {
      $set: {
        subscriptionStatus: input.status || "active",
        ...(input.nextChargeAt && { nextChargeAt: input.nextChargeAt }),
      },
    },
  );
  await fulfillPaidOrder(order);
}

/** Applies one `subscription.*` webhook event to the member it belongs to. */
export async function applySubscriptionEvent(
  event: string,
  subscription: RazorpaySubscription,
  payment?: { id?: string; amount?: number },
): Promise<void> {
  const member = await AiMember.findOne({ subscriptionId: subscription.id });
  if (!member) {
    // An older subscription they've since replaced, or not a Churro AI one.
    console.warn(`[webhook] ${event} for unknown subscription ${subscription.id}`);
    return;
  }
  const nextChargeAt = fromUnix(subscription.charge_at);

  switch (event) {
    case "subscription.activated":
      member.set({ subscriptionStatus: subscription.status, autoRenew: true, nextChargeAt });
      await member.save();
      return;

    case "subscription.charged":
      if (!payment?.id) return;
      await recordSubscriptionCharge({
        memberId: String(member._id),
        subscriptionId: subscription.id,
        paymentId: payment.id,
        amount: Math.round((payment.amount ?? 0) / 100),
        periodEnd: fromUnix(subscription.current_end),
        nextChargeAt,
        status: subscription.status,
      });
      return;

    case "subscription.pending": {
      // A renewal payment failed and Razorpay is retrying: keep access for a
      // few days past the paid period, measured from that period's end so a
      // repeat of this event never stretches it further.
      const periodEnd = fromUnix(subscription.current_end) ?? member.passExpiresAt ?? new Date();
      const graceEnd = new Date(periodEnd.getTime() + GRACE_DAYS * DAY_MS);
      member.set({ subscriptionStatus: "pending" });
      if (!member.passExpiresAt || member.passExpiresAt < graceEnd) member.passExpiresAt = graceEnd;
      await member.save();
      return;
    }

    case "subscription.halted":
    case "subscription.cancelled":
    case "subscription.completed":
      // No more charges. Access simply runs to whatever they've already paid for (or the grace end).
      member.set({ subscriptionStatus: subscription.status, autoRenew: false, nextChargeAt: undefined });
      await member.save();
      return;
  }
}
