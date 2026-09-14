import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";

import { lessonIdsOf } from "../lib/curriculum.js";
import { asyncHandler, HttpError } from "../lib/http.js";
import { activeProvider, createProviderOrder, verifyProviderPayment } from "../lib/payments.js";
import { authenticate, requireStudent } from "../middleware/auth.js";
import { Course } from "../models/Course.js";
import { Enrollment } from "../models/Enrollment.js";
import { Order } from "../models/Order.js";
import { User } from "../models/User.js";

export const ordersRouter = Router();
ordersRouter.use(authenticate, requireStudent);

/** An unpaid order holds its price for this long. */
const ORDER_TTL_MS = 30 * 60 * 1000;
const isObjectId = (id: string) => mongoose.isValidObjectId(id);

function summary(order: Record<string, unknown>, course: Record<string, unknown>, buyer: Record<string, unknown>) {
  const lessonCount = lessonIdsOf(course as { curriculum?: { lessons?: { id?: string }[] }[] }).length;
  return {
    id: String(order._id),
    status: order.status,
    provider: order.provider,
    testMode: order.provider === "dummy",
    amount: order.amount,
    listPrice: order.listPrice,
    discount: Number(order.listPrice) - Number(order.amount),
    currency: order.currency,
    expiresAt: new Date(order.expiresAt as string).toISOString(),
    course: {
      id: String(course._id),
      slug: course.slug,
      title: course.title,
      thumbnail: course.thumbnail,
      level: course.level,
      duration: course.duration,
      lessons: lessonCount,
      includedItems: course.includedItems ?? [],
    },
    buyer: { name: buyer.name, email: buyer.email },
  };
}

/**
 * Starts checkout. Validates everything up front so the modal can explain a
 * problem before the buyer reaches the pay button. The amount is read from the
 * database here and nowhere else.
 */
ordersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ courseId: z.string() }).safeParse(req.body);
    if (!parsed.success || !isObjectId(parsed.data.courseId)) throw new HttpError(400, "Which course?");

    const userId = req.user!.sub;
    const course = await Course.findOne({ _id: parsed.data.courseId, published: true }).lean();
    if (!course) throw new HttpError(404, "This course isn't available right now.");
    if (lessonIdsOf(course).length === 0) throw new HttpError(409, "This course has no lessons yet.");

    if (await Enrollment.exists({ user: userId, course: course._id })) {
      throw new HttpError(409, "You already own this course.");
    }
    const buyer = await User.findById(userId).lean();
    if (!buyer) throw new HttpError(401, "Sign in to continue.");

    const amount = course.discountPrice ?? course.price;

    // Reuse a still-open order at the same price instead of piling up new ones.
    let order = await Order.findOne({
      user: userId,
      course: course._id,
      status: "created",
      amount,
      expiresAt: { $gt: new Date() },
    });

    if (!order) {
      order = new Order({
        user: userId,
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

    res.status(201).json({
      order: summary(order.toObject() as Record<string, unknown>, course as Record<string, unknown>, buyer as Record<string, unknown>),
    });
  }),
);

/**
 * Completes payment. Order ownership, expiry, price, availability and prior
 * ownership are all re-checked at this moment, and the created -> paid
 * transition is a single atomic update, so a double click or a replayed request
 * can never grant a second enrollment or charge twice.
 */
ordersRouter.post(
  "/:id/confirm",
  asyncHandler(async (req, res) => {
    const orderId = String(req.params.id);
    if (!isObjectId(orderId)) throw new HttpError(404, "Order not found.");
    const userId = req.user!.sub;

    const order = await Order.findOne({ _id: orderId, user: userId });
    if (!order) throw new HttpError(404, "Order not found.");

    const course = await Course.findOne({ _id: String(order.course), published: true }).lean();
    const slug = course?.slug;

    if (order.status === "paid") {
      // Idempotent: the same confirm arriving twice is not an error.
      return res.json({ ok: true, alreadyPaid: true, slug });
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
    if (await Enrollment.exists({ user: userId, course: course._id })) {
      await Order.updateOne({ _id: order._id, status: "created" }, { status: "failed", failureReason: "already owned" });
      throw new HttpError(409, "You already own this course.");
    }

    const { providerPaymentId } = await verifyProviderPayment(
      { providerOrderId: order.providerOrderId },
      (req.body ?? {}) as Record<string, unknown>,
    );

    // Atomic claim: only one request can move this order out of "created".
    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, user: userId, status: "created" },
      { status: "paid", paidAt: new Date(), providerPaymentId },
      { new: true },
    );
    if (!claimed) return res.json({ ok: true, alreadyPaid: true, slug });

    try {
      await Enrollment.create({
        user: userId,
        course: course._id,
        amountPaid: claimed.amount,
        paymentStatus: "paid",
        paymentProvider: claimed.provider,
        order: claimed._id,
        paymentRef: providerPaymentId,
      });
    } catch (error) {
      // Unique (user, course) index: a concurrent confirm already enrolled them.
      if ((error as { code?: number }).code !== 11000) throw error;
    }

    res.json({ ok: true, slug });
  }),
);

/** Purchase history for the signed-in student. */
ordersRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const orders = await Order.find({ user: req.user!.sub, status: "paid" }).sort({ paidAt: -1 }).lean();
    res.json({
      orders: orders.map((o) => ({
        id: String(o._id),
        courseTitle: o.courseTitle,
        amount: o.amount,
        listPrice: o.listPrice,
        provider: o.provider,
        paidAt: o.paidAt ? new Date(o.paidAt).toISOString() : undefined,
        providerPaymentId: o.providerPaymentId,
      })),
    });
  }),
);
