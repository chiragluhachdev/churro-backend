import crypto from "node:crypto";
import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";

import { accessFor, getAiConfig, memberView, normalizeEmail } from "../lib/aiAccess.js";
import { requireMember, signMemberToken } from "../lib/aiAuth.js";
import { sendAiCodeEmail } from "../lib/aiCodeEmail.js";
import { recordSubscriptionCharge } from "../lib/aiRenewals.js";
import { fulfillPaidOrder } from "../lib/fulfillment.js";
import { asyncHandler, HttpError } from "../lib/http.js";
import { gstBreakdown, nextInvoiceNumber } from "../lib/invoice.js";
import { activeProvider, createProviderOrder, verifyProviderPayment } from "../lib/payments.js";
import {
  cancelSubscription,
  createSubscription,
  fetchSubscription,
  fromUnix,
  verifySubscriptionPayment,
} from "../lib/subscriptions.js";
import { AiMember } from "../models/AiMember.js";
import { AiOtp } from "../models/AiOtp.js";
import { BillingSettings } from "../models/BillingSettings.js";
import { Order } from "../models/Order.js";

/** Churro AI's own API: email sign-in, the free try, and buying the pass. */
export const aiRouter = Router();

const OTP_TTL_MIN = 10;
const OTP_TTL_MS = OTP_TTL_MIN * 60 * 1000;
const OTP_RESEND_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const ORDER_TTL_MS = 30 * 60 * 1000;

const hashCode = (email: string, code: string) => crypto.createHash("sha256").update(`${email}:${code}`).digest("hex");

export const passLabel = (days: number) =>
  days % 365 === 0 ? `${days / 365} year${days === 365 ? "" : "s"}` : `${days} days`;

/** Public: what the landing page, sign-in screen and paywall show. */
aiRouter.get(
  "/config",
  asyncHandler(async (_req, res) => {
    const c = await getAiConfig();
    res.json({
      config: {
        calculatorEnabled: c.calculatorEnabled,
        passName: c.passName,
        passPrice: c.passPrice,
        passDays: c.passDays,
        freeTries: c.freeTries,
        trialMinutes: c.trialMinutes,
        autoRenewEnabled: c.autoRenewEnabled,
      },
    });
  }),
);

/* ------------------------------------------------------------- sign-in -- */

aiRouter.post(
  "/auth/request-otp",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(String(req.body?.email ?? ""));
    if (!email) throw new HttpError(400, "Enter a valid email address.");

    const existing = await AiOtp.findOne({ email }).lean();
    if (existing && Date.now() - new Date(existing.updatedAt).getTime() < OTP_RESEND_MS) {
      throw new HttpError(429, "Please wait a few seconds before asking for another code.");
    }

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    await AiOtp.findOneAndUpdate(
      { email },
      { $set: { codeHash: hashCode(email, code), expiresAt: new Date(Date.now() + OTP_TTL_MS), attempts: 0 } },
      { upsert: true },
    );
    const sent = await sendAiCodeEmail(email, code, OTP_TTL_MIN);
    if (!sent.ok) {
      // Drop the code so the resend wait doesn't block them from trying again.
      await AiOtp.deleteOne({ email });
      throw new HttpError(502, "We couldn't send the code. Check the address and try again.");
    }
    res.json({ ok: true, email });
  }),
);

aiRouter.post(
  "/auth/verify-otp",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(String(req.body?.email ?? ""));
    const code = String(req.body?.code ?? "").trim();
    if (!email || !/^\d{6}$/.test(code)) throw new HttpError(400, "Enter the 6-digit code we emailed you.");

    const otp = await AiOtp.findOne({ email });
    if (!otp || otp.expiresAt.getTime() < Date.now()) throw new HttpError(400, "That code has expired. Ask for a new one.");
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, "Too many wrong tries. Ask for a new code.");

    const expected = Buffer.from(otp.codeHash);
    const given = Buffer.from(hashCode(email, code));
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
      await AiOtp.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
      throw new HttpError(400, "That code isn't right. Check it and try again.");
    }
    await AiOtp.deleteOne({ _id: otp._id });

    const member = await AiMember.findOneAndUpdate(
      { email },
      { $set: { lastLoginAt: new Date() } },
      { upsert: true, new: true },
    ).lean();
    res.json({ token: signMemberToken(String(member!._id)), member: memberView(member!, await getAiConfig()) });
  }),
);

/* -------------------------------------------------------------- member -- */

aiRouter.get(
  "/me",
  requireMember,
  asyncHandler(async (req, res) => {
    const member = await AiMember.findById(req.memberId).lean();
    if (!member) throw new HttpError(401, "Please sign in again.");
    res.json({ member: memberView(member, await getAiConfig()) });
  }),
);

/** Starts a free try. Safe to call twice: with a try running or a pass active, it just reports where they stand. */
aiRouter.post(
  "/trial/start",
  requireMember,
  asyncHandler(async (req, res) => {
    const config = await getAiConfig();
    if (!config.calculatorEnabled) throw new HttpError(409, "The Recipe Calculator isn't open yet.");

    const now = new Date();
    // One atomic update: only starts a try when one is left and nothing is already running.
    const started = await AiMember.findOneAndUpdate(
      {
        _id: req.memberId,
        freeTriesUsed: { $lt: config.freeTries },
        trialEndsAt: { $not: { $gt: now } },
        passExpiresAt: { $not: { $gt: now } },
      },
      { $set: { trialEndsAt: new Date(now.getTime() + config.trialMinutes * 60_000) }, $inc: { freeTriesUsed: 1 } },
      { new: true },
    ).lean();

    const member = started ?? (await AiMember.findById(req.memberId).lean());
    if (!member) throw new HttpError(401, "Please sign in again.");
    if (accessFor(member, config) === "locked") {
      throw new HttpError(402, "Your free try has been used. Get the pass to keep going.");
    }
    res.json({ member: memberView(member, config) });
  }),
);

/**
 * Spends the free try's one export (print/PDF or CSV). Pass holders export
 * freely, so this just says yes to them. Atomic, so two quick clicks can't
 * both get through.
 */
aiRouter.post(
  "/trial/export",
  requireMember,
  asyncHandler(async (req, res) => {
    const config = await getAiConfig();
    const now = new Date();
    const claimed = await AiMember.findOneAndUpdate(
      { _id: req.memberId, trialEndsAt: { $gt: now }, trialExportUsed: { $ne: true } },
      { $set: { trialExportUsed: true } },
      { new: true },
    ).lean();
    const member = claimed ?? (await AiMember.findById(req.memberId).lean());
    if (!member) throw new HttpError(401, "Please sign in again.");
    if (!claimed && accessFor(member, config) !== "pass") {
      throw new HttpError(402, "Your free try includes one export, and it's been used. Get the pass for unlimited exports.");
    }
    res.json({ member: memberView(member, config) });
  }),
);

/* ----------------------------------------------------------- the pass -- */

const buyerSchema = z.object({
  name: z.string().trim().min(2, "Enter your name."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
});

async function passOrderView(order: InstanceType<typeof Order>) {
  const settings = await BillingSettings.findOne({ key: "billing" }).lean();
  return {
    id: String(order._id),
    status: order.status,
    provider: order.provider,
    testMode: order.provider === "dummy",
    amount: order.amount,
    currency: order.currency,
    passName: order.courseTitle,
    passDays: order.passDays,
    gst: gstBreakdown(order.amount, settings?.gstRate ?? 18),
    providerOrderId: order.providerOrderId || "",
    razorpayKeyId: order.provider === "razorpay" ? process.env.RAZORPAY_KEY_ID || "" : "",
    buyer: { name: order.buyerName, email: order.buyerEmail, phone: order.buyerPhone },
    seller: { companyName: settings?.companyName || "Churro Academy" },
  };
}

/** Starts buying the pass. The price comes from Admin → Churro AI, never from the browser. */
aiRouter.post(
  "/orders",
  requireMember,
  asyncHandler(async (req, res) => {
    const parsed = buyerSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check your details and try again.");
    const { name, email } = parsed.data;

    const member = await AiMember.findById(req.memberId);
    if (!member) throw new HttpError(401, "Please sign in again.");
    const config = await getAiConfig();
    const amount = config.passPrice;

    // Reuse a still-open order at the same price instead of piling up new ones.
    let order = await Order.findOne({
      kind: "ai_pass",
      aiMember: member._id,
      status: "created",
      amount,
      expiresAt: { $gt: new Date() },
    });
    if (order) {
      order.buyerName = name;
      order.buyerEmail = email;
      await order.save();
    } else {
      order = new Order({
        kind: "ai_pass",
        aiMember: member._id,
        buyerName: name,
        buyerEmail: email,
        buyerPhone: member.phone ?? "",
        courseTitle: `${config.passName} (${passLabel(config.passDays)})`,
        amount,
        listPrice: amount,
        passDays: config.passDays,
        provider: activeProvider(),
        expiresAt: new Date(Date.now() + ORDER_TTL_MS),
      });
      const gateway = await createProviderOrder({ id: String(order._id), amount });
      order.providerOrderId = gateway.providerOrderId;
      await order.save();
    }

    // Only the name: the invoice email can differ, but the sign-in email never changes here.
    member.name = name;
    await member.save();
    res.status(201).json({ order: await passOrderView(order) });
  }),
);

/**
 * Completes the purchase. Same atomic created -> paid claim as course
 * checkout and the Razorpay webhook, so whichever arrives first grants the
 * pass and the other is a no-op.
 */
aiRouter.post(
  "/orders/:id/confirm",
  requireMember,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, "Order not found.");
    const order = await Order.findOne({ _id: id, kind: "ai_pass", aiMember: req.memberId });
    if (!order) throw new HttpError(404, "Order not found.");

    if (order.status === "created") {
      if (order.expiresAt.getTime() < Date.now()) {
        await Order.updateOne({ _id: order._id, status: "created" }, { status: "expired" });
        throw new HttpError(410, "This checkout expired. Please start again.");
      }
      const { providerPaymentId } = await verifyProviderPayment(
        { providerOrderId: order.providerOrderId },
        (req.body ?? {}) as Record<string, unknown>,
      );
      const invoiceNumber = await nextInvoiceNumber();
      const claimed = await Order.findOneAndUpdate(
        { _id: order._id, status: "created" },
        { status: "paid", paidAt: new Date(), providerPaymentId, invoiceNumber },
        { new: true },
      );
      if (claimed) await fulfillPaidOrder(claimed);
    } else if (order.status !== "paid") {
      throw new HttpError(409, "This order can no longer be paid. Please start again.");
    }

    const member = await AiMember.findById(req.memberId).lean();
    res.json({ member: memberView(member!, await getAiConfig()) });
  }),
);

/* --------------------------------------------------------- auto-renewal -- */

/** Razorpay's states in which the mandate is live and will charge again. */
const RENEWING = new Set(["created", "authenticated", "active", "pending"]);

/**
 * Starts an auto-renewing pass: makes the Razorpay subscription the buyer
 * then approves in Checkout (UPI Autopay or card). Nothing is granted here —
 * that waits for a verified first charge.
 */
aiRouter.post(
  "/subscriptions",
  requireMember,
  asyncHandler(async (req, res) => {
    const parsed = buyerSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check your details and try again.");
    const config = await getAiConfig();
    if (!config.autoRenewEnabled) throw new HttpError(409, "Auto-renewal isn't offered right now. Please choose “Pay once”.");

    const member = await AiMember.findById(req.memberId);
    if (!member) throw new HttpError(401, "Please sign in again.");
    if (member.autoRenew && member.subscriptionStatus && RENEWING.has(member.subscriptionStatus)) {
      throw new HttpError(409, "Auto-renewal is already on for your account.");
    }

    const subscription = await createSubscription(config, String(member._id));
    member.set({
      name: parsed.data.name,
      invoiceEmail: parsed.data.email,
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      autoRenew: false,
    });
    await member.save();

    res.status(201).json({
      subscription: {
        id: subscription.id,
        testMode: activeProvider() === "dummy",
        razorpayKeyId: activeProvider() === "razorpay" ? process.env.RAZORPAY_KEY_ID || "" : "",
        amount: config.passPrice,
        passName: config.passName,
        passDays: config.passDays,
        buyer: { name: parsed.data.name, email: parsed.data.email },
      },
    });
  }),
);

/** Checkout's success callback: verifies it, books the first charge and switches auto-renew on. */
aiRouter.post(
  "/subscriptions/confirm",
  requireMember,
  asyncHandler(async (req, res) => {
    const member = await AiMember.findById(req.memberId);
    if (!member?.subscriptionId) throw new HttpError(404, "No auto-renewal checkout in progress.");
    const subscriptionId = member.subscriptionId;
    const paymentId = verifySubscriptionPayment((req.body ?? {}) as Record<string, unknown>, subscriptionId);

    const config = await getAiConfig();
    const subscription = await fetchSubscription(subscriptionId).catch(() => null);
    member.set({
      autoRenew: true,
      subscriptionStatus: subscription?.status && subscription.status !== "created" ? subscription.status : "active",
    });
    await member.save();

    await recordSubscriptionCharge({
      memberId: String(member._id),
      subscriptionId,
      paymentId,
      amount: config.passPrice,
      periodEnd: fromUnix(subscription?.current_end),
      nextChargeAt: fromUnix(subscription?.charge_at),
      status: member.subscriptionStatus ?? "active",
    });

    const fresh = await AiMember.findById(member._id).lean();
    res.json({ member: memberView(fresh!, config) });
  }),
);

/** Turns auto-renewal off. They keep the period they've already paid for. */
aiRouter.post(
  "/subscriptions/cancel",
  requireMember,
  asyncHandler(async (req, res) => {
    const member = await AiMember.findById(req.memberId);
    if (!member?.subscriptionId || !member.autoRenew) throw new HttpError(409, "Auto-renewal isn't on.");
    await cancelSubscription(member.subscriptionId, true);
    member.set({ autoRenew: false, nextChargeAt: undefined });
    await member.save();
    res.json({ member: memberView(member.toObject(), await getAiConfig()) });
  }),
);
