import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";

import { asyncHandler, HttpError } from "../lib/http.js";
import { gstBreakdown, nextInvoiceNumber } from "../lib/invoice.js";
import { dispatchOrderEmail } from "../lib/orderEmail.js";
import { activeProvider, createProviderOrder, verifyProviderPayment } from "../lib/payments.js";
import { BillingSettings } from "../models/BillingSettings.js";
import { Course } from "../models/Course.js";
import { Order } from "../models/Order.js";

export const ordersRouter = Router();

/**
 * Checkout is guest-only: there is no student dashboard or in-app content to
 * unlock, so there is nothing an account would gain the buyer. The course
 * material is sent by hand over WhatsApp once payment is confirmed. Anyone
 * with the order id — an unguessable Mongo ObjectId, handed back only to the
 * browser that created it — can view or confirm that one order; that stands
 * in for a session token until Razorpay's own signed callbacks take over.
 */

/** An unpaid order holds its price for this long. */
const ORDER_TTL_MS = 30 * 60 * 1000;
const isObjectId = (id: string) => mongoose.isValidObjectId(id);

async function billingSettings() {
  const doc = await BillingSettings.findOne({ key: "billing" }).lean();
  return {
    companyName: doc?.companyName || "Churro Academy",
    gstin: doc?.gstin || "",
    address: doc?.address || "",
    email: doc?.email || "",
    phone: doc?.phone || "",
    gstRate: doc?.gstRate ?? 18,
  };
}

async function orderSummary(order: Record<string, unknown>, course: Record<string, unknown> | null) {
  const settings = await billingSettings();
  const gst = gstBreakdown(Number(order.amount), settings.gstRate);
  return {
    id: String(order._id),
    status: order.status,
    provider: order.provider,
    testMode: order.provider === "dummy",
    amount: order.amount,
    listPrice: order.listPrice,
    discount: Number(order.listPrice) - Number(order.amount),
    currency: order.currency,
    expiresAt: order.expiresAt ? new Date(order.expiresAt as string).toISOString() : undefined,
    paidAt: order.paidAt ? new Date(order.paidAt as string).toISOString() : undefined,
    invoiceNumber: order.invoiceNumber || "",
    gst,
    course: course
      ? {
          id: String(course._id),
          slug: course.slug,
          title: course.title,
          thumbnail: course.thumbnail,
          level: course.level,
          duration: course.duration,
          lessons: course.lessons,
          includedItems: course.includedItems ?? [],
        }
      : { title: order.courseTitle },
    buyer: { name: order.buyerName, email: order.buyerEmail, phone: order.buyerPhone },
    seller: settings,
  };
}

const startSchema = z.object({
  courseId: z.string(),
  name: z.string().trim().min(2, "Enter your name."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  // Loose on purpose — Indian numbers, optional +91, spaces or dashes.
  phone: z
    .string()
    .trim()
    .min(7, "Enter a WhatsApp number we can reach you on.")
    .max(20)
    .regex(/^[+\d][\d\s-]*$/, "Enter a valid phone number."),
});

/**
 * Starts checkout. Validates everything up front so the modal can explain a
 * problem before the buyer reaches the pay button. The amount is read from the
 * database here and nowhere else.
 */
ordersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check your details and try again.");
    const { courseId, name, email, phone } = parsed.data;
    if (!isObjectId(courseId)) throw new HttpError(400, "Which course?");

    const course = await Course.findOne({ _id: courseId, published: true }).lean();
    if (!course) throw new HttpError(404, "This course isn't available right now.");

    if (await Order.exists({ course: course._id, buyerEmail: email, status: "paid" })) {
      throw new HttpError(
        409,
        "You've already enrolled in this course — check WhatsApp for your link, or message us if you need it resent.",
      );
    }

    const amount = course.discountPrice ?? course.price;

    // Reuse a still-open order at the same price instead of piling up new ones.
    let order = await Order.findOne({
      buyerEmail: email,
      course: course._id,
      status: "created",
      amount,
      expiresAt: { $gt: new Date() },
    });

    if (order) {
      // The buyer may have retyped their name/number since the last attempt.
      order.buyerName = name;
      order.buyerPhone = phone;
      await order.save();
    } else {
      order = new Order({
        buyerName: name,
        buyerEmail: email,
        buyerPhone: phone,
        course: course._id,
        courseTitle: course.title,
        amount,
        listPrice: course.price,
        provider: activeProvider(),
        expiresAt: new Date(Date.now() + ORDER_TTL_MS),
      });
      const gateway = await createProviderOrder({ id: String(order._id), amount });
      order.providerOrderId = gateway.providerOrderId;
      await order.save();
    }

    res.status(201).json({ order: await orderSummary(order.toObject() as Record<string, unknown>, course as Record<string, unknown>) });
  }),
);

/**
 * Completes payment. Expiry, price and availability are all re-checked at
 * this moment, and the created -> paid transition is a single atomic update,
 * so a double click or a replayed request can never charge twice or hand out
 * two invoice numbers for the same order.
 */
ordersRouter.post(
  "/:id/confirm",
  asyncHandler(async (req, res) => {
    const orderId = String(req.params.id);
    if (!isObjectId(orderId)) throw new HttpError(404, "Order not found.");

    const order = await Order.findById(orderId);
    if (!order) throw new HttpError(404, "Order not found.");

    const course = await Course.findOne({ _id: String(order.course), published: true }).lean();

    if (order.status === "paid") {
      // Idempotent: the same confirm arriving twice is not an error.
      return res.json({ ok: true, orderId: String(order._id) });
    }
    if (order.status !== "created") throw new HttpError(409, "This order can no longer be paid. Please start again.");
    if (order.expiresAt.getTime() < Date.now()) {
      await Order.updateOne({ _id: order._id, status: "created" }, { status: "expired" });
      throw new HttpError(410, "This checkout expired. Please start again.");
    }
    if (!course) {
      await Order.updateOne({ _id: order._id, status: "created" }, { status: "failed", failureReason: "course unavailable" });
      throw new HttpError(409, "This course is no longer available.");
    }
    const currentPrice = course.discountPrice ?? course.price;
    if (currentPrice !== order.amount) {
      await Order.updateOne({ _id: order._id, status: "created" }, { status: "failed", failureReason: "price changed" });
      throw new HttpError(409, "The price of this course changed. Please review the new price.");
    }
    const alreadyPaid = await Order.countDocuments({
      _id: { $ne: order._id },
      course: String(course._id),
      buyerEmail: order.buyerEmail,
      status: "paid",
    });
    if (alreadyPaid > 0) {
      await Order.updateOne({ _id: order._id, status: "created" }, { status: "failed", failureReason: "already purchased" });
      throw new HttpError(409, "You've already enrolled in this course.");
    }

    const { providerPaymentId } = await verifyProviderPayment(
      { providerOrderId: order.providerOrderId },
      (req.body ?? {}) as Record<string, unknown>,
    );

    // Atomic claim: only one request can move this order out of "created", so
    // only one can ever hand out an invoice number for it.
    const invoiceNumber = await nextInvoiceNumber();
    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, status: "created" },
      { status: "paid", paidAt: new Date(), providerPaymentId, invoiceNumber },
      { new: true },
    );
    if (!claimed) return res.json({ ok: true, orderId: String(order._id) });

    // Fire-and-forget: a slow or failed email must never hold up — or undo —
    // a payment that's already gone through. Failures are recorded on the
    // order for the admin to see and retry from the billing screen.
    void dispatchOrderEmail(claimed);

    res.json({ ok: true, orderId: String(claimed._id) });
  }),
);

/** Order status / receipt, for the confirmation and invoice screens. */
ordersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const orderId = String(req.params.id);
    if (!isObjectId(orderId)) throw new HttpError(404, "Order not found.");
    const order = await Order.findById(orderId).lean();
    if (!order) throw new HttpError(404, "Order not found.");
    const course = await Course.findById(order.course).lean();
    res.json({ order: await orderSummary(order as Record<string, unknown>, course as Record<string, unknown> | null) });
  }),
);
