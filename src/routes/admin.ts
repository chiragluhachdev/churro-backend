import { Router } from "express";
import mongoose from "mongoose";

import { asyncHandler, HttpError } from "../lib/http.js";
import { gstBreakdown } from "../lib/invoice.js";
import { dispatchOrderEmail } from "../lib/orderEmail.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { BillingSettings } from "../models/BillingSettings.js";
import { Course } from "../models/Course.js";
import { Order } from "../models/Order.js";

export const adminRouter = Router();

adminRouter.use(authenticate, requireAdmin);

adminRouter.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const [courses, paidOrders, customers, revenue] = await Promise.all([
      Course.countDocuments({}),
      Order.countDocuments({ status: "paid" }),
      Order.distinct("buyerEmail", { status: "paid" }),
      Order.aggregate<{ total: number }>([
        { $match: { status: "paid" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);
    res.json({
      stats: { courses, paidOrders, customers: customers.length, revenue: revenue[0]?.total ?? 0 },
    });
  }),
);

/** Full catalogue including unpublished drafts. */
adminRouter.get(
  "/courses",
  asyncHandler(async (_req, res) => {
    const docs = await Course.find({}).sort({ createdAt: -1 }).lean();
    const counts = await Order.aggregate<{ _id: unknown; n: number }>([
      { $match: { status: "paid" } },
      { $group: { _id: "$course", n: { $sum: 1 } } },
    ]);
    const byCourse = new Map(counts.map((c) => [String(c._id), c.n]));

    res.json({
      courses: docs.map((d) => {
        const { _id, __v, ...rest } = d as Record<string, unknown> & { _id: unknown };
        void __v;
        return { ...rest, id: String(_id), enrollmentCount: byCourse.get(String(_id)) ?? 0 };
      }),
    });
  }),
);

/** The billing/audit screen: every order, with the GST breakdown behind each amount. */
adminRouter.get(
  "/orders",
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    const status = String(req.query.status ?? "");
    if (["created", "paid", "failed", "expired"].includes(status)) filter.status = status;
    const q = String(req.query.q ?? "").trim();
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ buyerName: rx }, { buyerEmail: rx }, { buyerPhone: rx }, { courseTitle: rx }, { invoiceNumber: rx }];
    }

    const [docs, settings] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).limit(500).lean(),
      BillingSettings.findOne({ key: "billing" }).lean(),
    ]);
    const gstRate = settings?.gstRate ?? 18;

    res.json({
      orders: docs.map((d) => ({
        id: String(d._id),
        invoiceNumber: d.invoiceNumber || "",
        buyerName: d.buyerName,
        buyerEmail: d.buyerEmail,
        buyerPhone: d.buyerPhone,
        courseTitle: d.courseTitle,
        amount: d.amount,
        listPrice: d.listPrice,
        status: d.status,
        provider: d.provider,
        gst: gstBreakdown(d.amount, gstRate),
        createdAt: (d.createdAt as Date | undefined)?.toISOString(),
        paidAt: d.paidAt ? new Date(d.paidAt).toISOString() : undefined,
        emailSentAt: d.emailSentAt ? new Date(d.emailSentAt).toISOString() : undefined,
        emailError: d.emailError || "",
      })),
    });
  }),
);

/** One order, with everything the printable invoice needs. */
adminRouter.get(
  "/orders/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, "Order not found.");
    const order = await Order.findById(id).lean();
    if (!order) throw new HttpError(404, "Order not found.");
    const [course, settings] = await Promise.all([
      Course.findById(order.course).lean(),
      BillingSettings.findOne({ key: "billing" }).lean(),
    ]);
    const gstRate = settings?.gstRate ?? 18;

    res.json({
      order: {
        id: String(order._id),
        invoiceNumber: order.invoiceNumber || "",
        status: order.status,
        provider: order.provider,
        providerPaymentId: order.providerPaymentId,
        amount: order.amount,
        listPrice: order.listPrice,
        currency: order.currency,
        gst: gstBreakdown(order.amount, gstRate),
        createdAt: (order.createdAt as Date | undefined)?.toISOString(),
        paidAt: order.paidAt ? new Date(order.paidAt).toISOString() : undefined,
        buyer: { name: order.buyerName, email: order.buyerEmail, phone: order.buyerPhone },
        course: course ? { title: course.title, slug: course.slug } : { title: order.courseTitle, slug: "" },
        seller: {
          companyName: settings?.companyName || "Churro Academy",
          gstin: settings?.gstin || "",
          address: settings?.address || "",
          email: settings?.email || "",
          phone: settings?.phone || "",
        },
        emailSentAt: order.emailSentAt ? new Date(order.emailSentAt).toISOString() : undefined,
        emailError: order.emailError || "",
        // What the enrollment email lists — lets the admin see exactly what a
        // resend would go out with, including which lessons still lack a link.
        emailSections: (course?.curriculum ?? []).map((section) => ({
          title: section.title,
          lessons: section.lessons.map((l) => ({ title: l.title, hasVideo: Boolean(l.videoUrl) })),
        })),
      },
    });
  }),
);

/** Resends the enrollment email with whatever video links exist right now. */
adminRouter.post(
  "/orders/:id/resend-email",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, "Order not found.");
    const order = await Order.findById(id);
    if (!order) throw new HttpError(404, "Order not found.");
    if (order.status !== "paid") throw new HttpError(409, "This order hasn't been paid, so there's nothing to send.");

    const result = await dispatchOrderEmail(order);
    if (!result.ok) throw new HttpError(502, `Email didn't send: ${result.error}`);
    res.json({ ok: true });
  }),
);
