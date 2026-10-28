import { dispatchOrderEmail } from "./orderEmail.js";
import { AiMember } from "../models/AiMember.js";
import { Order, type OrderDoc } from "../models/Order.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What happens once an order has been atomically claimed as paid — from the
 * buyer's own confirm or from Razorpay's webhook, whichever got there first.
 * A course order just gets its email; a Churro AI pass is granted first.
 * Never throws: the payment has already gone through.
 */
export async function fulfillPaidOrder(order: OrderDoc): Promise<void> {
  try {
    if (order.kind !== "ai_pass") {
      await dispatchOrderEmail(order);
      return;
    }
    // Access first, so the buyer's confirm can answer with the pass already active; the email follows.
    const granted = await grantPass(order);
    if (granted) {
      void dispatchOrderEmail(granted).catch((error) =>
        console.error(`[fulfil] pass email for ${String(order._id)} failed:`, error),
      );
    }
  } catch (error) {
    console.error(`[fulfil] order ${String(order._id)} failed:`, error);
  }
}

/**
 * One-time pass: extends from today, or from the current end if still
 * running (early renewals aren't lost). Auto-renewal charge: runs to the end
 * of the period Razorpay billed, never cutting short time already held.
 */
async function grantPass(order: OrderDoc) {
  const member = await AiMember.findById(order.aiMember);
  if (!member) {
    console.error(`[fulfil] pass order ${String(order._id)} has no member`);
    return null;
  }
  const now = new Date();
  const from = member.passExpiresAt && member.passExpiresAt > now ? member.passExpiresAt : now;
  const passUntil = order.periodEnd
    ? new Date(Math.max(order.periodEnd.getTime(), member.passExpiresAt?.getTime() ?? 0))
    : new Date(from.getTime() + (order.passDays ?? 365) * DAY_MS);

  // Only one caller can stamp passUntil, so a pass is never granted twice for one payment.
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, passUntil: { $exists: false } },
    { $set: { passUntil } },
    { new: true },
  );
  if (!claimed) return null;

  // Not the email: that's their sign-in identity, and the invoice may go elsewhere.
  await AiMember.updateOne({ _id: member._id }, { $set: { passExpiresAt: passUntil, name: order.buyerName } });
  return claimed;
}
