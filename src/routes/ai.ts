import crypto from "node:crypto";
import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";

import { accessFor, getAiConfig, memberView, normalizePhone } from "../lib/aiAccess.js";
import { requireMember, signMemberToken } from "../lib/aiAuth.js";
import { fulfillPaidOrder } from "../lib/fulfillment.js";
import { asyncHandler, HttpError } from "../lib/http.js";
import { gstBreakdown, nextInvoiceNumber } from "../lib/invoice.js";
import { activeProvider, createProviderOrder, verifyProviderPayment } from "../lib/payments.js";
import { AiMember } from "../models/AiMember.js";
import { AiOtp } from "../models/AiOtp.js";
import { BillingSettings } from "../models/BillingSettings.js";
import { Order } from "../models/Order.js";

/** Churro AI's own API: phone sign-in, the free try, and buying the pass. */
export const aiRouter = Router();

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const ORDER_TTL_MS = 30 * 60 * 1000;

const hashCode = (phone: string, code: string) => crypto.createHash("sha256").update(`${phone}:${code}`).digest("hex");

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
        // Shown on the sign-in screen on purpose: there's no SMS provider yet,
        // so this demo code is the only way anyone can sign in.
        demoOtp: c.demoOtp,
      },
    });
  }),
);

/* ------------------------------------------------------------- sign-in -- */

aiRouter.post(
  "/auth/request-otp",
  asyncHandler(async (req, res) => {
    const phone = normalizePhone(String(req.body?.phone ?? ""));
    if (!phone) throw new HttpError(400, "Enter a valid 10-digit mobile number.");

    const existing = await AiOtp.findOne({ phone }).lean();
    if (existing && Date.now() - new Date(existing.updatedAt).getTime() < OTP_RESEND_MS) {
      throw new HttpError(429, "Please wait a few seconds before asking for another code.");
    }

    // No SMS provider yet, so the code is the admin's demo code. When one is
    // connected, generate a random code here and send it instead.
    const { demoOtp: code } = await getAiConfig();
    await AiOtp.findOneAndUpdate(
      { phone },
      { $set: { codeHash: hashCode(phone, code), expiresAt: new Date(Date.now() + OTP_TTL_MS), attempts: 0 } },
      { upsert: true },
    );
    res.json({ ok: true, phone });
  }),
);

aiRouter.post(
  "/auth/verify-otp",
  asyncHandler(async (req, res) => {
    const phone = normalizePhone(String(req.body?.phone ?? ""));
    const code = String(req.body?.code ?? "").trim();
    if (!phone || !/^\d{4,8}$/.test(code)) throw new HttpError(400, "Enter the code we sent you.");

    const otp = await AiOtp.findOne({ phone });
    if (!otp || otp.expiresAt.getTime() < Date.now()) throw new HttpError(400, "That code has expired. Ask for a new one.");
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, "Too many wrong tries. Ask for a new code.");

    const expected = Buffer.from(otp.codeHash);
    const given = Buffer.from(hashCode(phone, code));
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
      await AiOtp.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
      throw new HttpError(400, "That code isn't right. Check it and try again.");
    }
    await AiOtp.deleteOne({ _id: otp._id });

    const member = await AiMember.findOneAndUpdate(
      { phone },
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
        buyerPhone: member.phone,
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

    member.name = name;
    member.email = email;
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
