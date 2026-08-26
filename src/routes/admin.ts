import { Router } from "express";

import { asyncHandler } from "../lib/http.js";
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
          user: user ? { name: user.name, username: user.username, email: user.email } : null,
          course: course ? { title: course.title, slug: course.slug } : null,
          amountPaid: Number(raw.amountPaid ?? 0),
          paymentStatus: raw.paymentStatus,
          createdAt: new Date(raw.createdAt as string).toISOString(),
        };
      }),
    });
  }),
);
