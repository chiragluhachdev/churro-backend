import crypto from "node:crypto";
import express, { Router } from "express";

import { nextInvoiceNumber } from "../lib/invoice.js";
import { dispatchOrderEmail } from "../lib/orderEmail.js";
import { Order } from "../models/Order.js";

export const webhooksRouter = Router();

/**
 * Safety net for the one gap the client-confirm flow has: if a payment
 * captures on Razorpay's side but the buyer's browser never calls back
 * (closed tab, crash, flaky network) right after paying, the order would
 * otherwise sit "created" forever — paid for, but never marked paid, no
 * invoice, no email. Razorpay calls this route directly once money moves,
 * independent of the browser.
 *
 * Mounted with its own raw-body parser, and registered in index.ts *before*
 * the app-wide express.json() — the signature is computed over the exact
 * bytes Razorpay sent, so re-serialized JSON (different key order, spacing)
 * would fail verification even for a genuine event.
 */
webhooksRouter.post(
  "/razorpay",
  express.raw({ type: "application/json", limit: "1mb" }),
  (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];
    const rawBody = req.body as Buffer;

    if (!secret) {
      console.error("[webhook] RAZORPAY_WEBHOOK_SECRET is not set — rejecting.");
      return res.status(503).end();
    }
    if (typeof signature !== "string" || !Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      return res.status(400).end();
    }

    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const expectedBuf = Buffer.from(expected, "utf8");
    const signatureBuf = Buffer.from(signature, "utf8");
    const valid = expectedBuf.length === signatureBuf.length && crypto.timingSafeEqual(expectedBuf, signatureBuf);
    if (!valid) {
      console.warn("[webhook] signature did not match — ignoring.");
      return res.status(400).end();
    }

    let event: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string } } } };
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).end();
    }

    // Acknowledge immediately once verified — Razorpay retries on anything
    // but a 2xx, and the actual DB work below doesn't need to block that.
    res.status(200).json({ ok: true });

    if (event.event !== "payment.captured") return;
    const payment = event.payload?.payment?.entity;
    const razorpayOrderId = payment?.order_id;
    const paymentId = payment?.id;
    if (!razorpayOrderId || !paymentId) return;

    void (async () => {
      const order = await Order.findOne({ providerOrderId: razorpayOrderId });
      if (!order) {
        console.warn(`[webhook] payment.captured for unknown order ${razorpayOrderId}`);
        return;
      }
      if (order.status !== "created") return; // already handled by the client's own confirm — normal, not an error

      // Same atomic claim as POST /orders/:id/confirm: only one path can
      // ever move an order out of "created", so this and a client confirm
      // racing each other can never both succeed.
      const invoiceNumber = await nextInvoiceNumber();
      const claimed = await Order.findOneAndUpdate(
        { _id: order._id, status: "created" },
        { status: "paid", paidAt: new Date(), providerPaymentId: paymentId, invoiceNumber },
        { new: true },
      );
      if (!claimed) return; // lost the race to the client's own confirm

      console.log(`[webhook] order ${String(claimed._id)} marked paid — client never confirmed, webhook caught it`);
      void dispatchOrderEmail(claimed);
    })().catch((error) => console.error("[webhook] processing failed:", error));
  },
);
