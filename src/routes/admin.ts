import { Router } from "express";
import mongoose from "mongoose";

import { asyncHandler, HttpError } from "../lib/http.js";
import { Order } from "../models/Order.js";
import { shapeEnrollment } from "./enrollments.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { Course } from "../models/Course.js";
import { Enrollment } from "../models/Enrollment.js";
import { User } from "../models/User.js";

export const adminRouter = Router();

adminRouter.use(authenticate, requireAdmin);

adminRouter.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const [users, courses, enrollments, revenue] = await Promise.all([
      User.countDocuments({}),
      Course.countDocuments({}),
      Enrollment.countDocuments({}),
      Enrollment.aggregate<{ total: number }>([
        { $match: { paymentStatus: "paid" } },
        { $group: { _id: null, total: { $sum: "$amountPaid" } } },
      ]),
    ]);
    res.json({
      stats: { users, courses, enrollments, revenue: revenue[0]?.total ?? 0 },
    });
  }),
);

/** Full catalogue including unpublished drafts. */
adminRouter.get(
  "/courses",
  asyncHandler(async (_req, res) => {
    const docs = await Course.find({}).sort({ createdAt: -1 }).lean();
    const counts = await Enrollment.aggregate<{ _id: unknown; n: number }>([
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

adminRouter.get(
  "/users",
  asyncHandler(async (_req, res) => {
    const docs = await User.find({}).sort({ createdAt: -1 }).limit(200).lean();
    const counts = await Enrollment.aggregate<{ _id: unknown; n: number }>([
      { $group: { _id: "$user", n: { $sum: 1 } } },
    ]);
    const byUser = new Map(counts.map((c) => [String(c._id), c.n]));

    res.json({
      users: docs.map((d) => ({
        id: String(d._id),
        name: d.name,
        username: d.username,
        email: d.email,
        role: d.role,
        createdAt: (d.createdAt as Date | undefined)?.toISOString(),
        enrollmentCount: byUser.get(String(d._id)) ?? 0,
      })),
    });
  }),
);

adminRouter.get(
  "/enrollments",
  asyncHandler(async (_req, res) => {
    const docs = await Enrollment.find({})
      .populate("user", "name username email")
      .populate("course", "title slug")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.json({
      enrollments: docs.map((d) => {
        const raw = d as Record<string, unknown>;
        const user = raw.user as Record<string, unknown> | null;
        const course = raw.course as Record<string, unknown> | null;
        return {
          id: String(raw._id),
          user: user ? { id: String(user._id), name: user.name, username: user.username, email: user.email } : null,
          course: course ? { title: course.title, slug: course.slug } : null,
          amountPaid: Number(raw.amountPaid ?? 0),
          paymentStatus: raw.paymentStatus,
          createdAt: new Date(raw.createdAt as string).toISOString(),
        };
      }),
    });
  }),
);

/** Everything about one student: account, courses, lesson-level progress, payments. */
adminRouter.get(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, "Student not found.");
    const user = await User.findById(id).lean();
    if (!user) throw new HttpError(404, "Student not found.");

    const [enrollmentDocs, orders] = await Promise.all([
      Enrollment.find({ user: id }).populate("course").sort({ createdAt: -1 }).lean(),
      Order.find({ user: id }).sort({ createdAt: -1 }).limit(100).lean(),
    ]);

    const enrollments = enrollmentDocs
      .map((doc) => {
        const shaped = shapeEnrollment(doc as Record<string, unknown>);
        if (!shaped) return null;
        const course = doc.course as unknown as { curriculum?: { title: string; lessons: { id: string; title: string; duration: number }[] }[] };
        const done = new Set(shaped.completedLessonIds);
        return {
          ...shaped,
          // Lesson-by-lesson view for the admin.
          sections: (course.curriculum ?? []).map((m) => ({
            title: m.title,
            lessons: m.lessons.map((l) => ({ id: l.id, title: l.title, duration: l.duration, done: done.has(l.id) })),
          })),
        };
      })
      .filter(Boolean);

    const paid = orders.filter((o) => o.status === "paid");
    res.json({
      user: {
        id: String(user._id),
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        createdAt: (user.createdAt as Date | undefined)?.toISOString(),
      },
      summary: {
        coursesOwned: enrollments.length,
        coursesCompleted: enrollments.filter((e) => e!.isComplete).length,
        lessonsCompleted: enrollments.reduce((s, e) => s + e!.completedLessons, 0),
        // From enrollments, so courses bought before orders existed still count.
        totalSpent: enrollments.reduce((s, e) => s + e!.amountPaid, 0),
        paidOrders: paid.length,
        lastActiveAt: enrollments.map((e) => e!.lastOpenedAt).sort().at(-1),
      },
      enrollments,
      orders: orders.map((o) => ({
        id: String(o._id),
        courseTitle: o.courseTitle,
        amount: o.amount,
        listPrice: o.listPrice,
        status: o.status,
        provider: o.provider,
        providerPaymentId: o.providerPaymentId,
        createdAt: (o.createdAt as Date | undefined)?.toISOString(),
        paidAt: o.paidAt ? new Date(o.paidAt).toISOString() : undefined,
      })),
    });
  }),
);
