import { Router } from "express";
import { z } from "zod";

import { asyncHandler, HttpError } from "../lib/http.js";
import { authenticate, requireAuth } from "../middleware/auth.js";
import { Course } from "../models/Course.js";
import { Enrollment } from "../models/Enrollment.js";

export const enrollmentsRouter = Router();

interface CourseLike {
  _id: unknown;
  lessons: number;
  [key: string]: unknown;
}

function shape(enrollment: Record<string, unknown>) {
  const course = enrollment.course as CourseLike | null;
  if (!course) return null;

  const { _id: courseId, __v, ...courseRest } = course as CourseLike & { __v?: unknown };
  void __v;
  const completedLessons = Number(enrollment.completedLessons ?? 0);
  const total = Number(course.lessons ?? 0);
  const progress = total > 0 ? Math.min(100, Math.round((completedLessons / total) * 100)) : 0;

  return {
    id: String(enrollment._id),
    course: { ...courseRest, id: String(courseId) },
    completedLessons,
    progress,
    isComplete: progress >= 100,
    lastOpenedAt: new Date(enrollment.lastOpenedAt as string).toISOString(),
    completedAt: enrollment.completedAt
      ? new Date(enrollment.completedAt as string).toISOString()
      : undefined,
    amountPaid: Number(enrollment.amountPaid ?? 0),
    paymentStatus: enrollment.paymentStatus,
  };
}

/** Everything the signed-in student owns. */
enrollmentsRouter.get(
  "/me",
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => {
    const docs = await Enrollment.find({ user: req.user!.sub })
      .populate("course")
      .sort({ lastOpenedAt: -1 })
      .lean();
    res.json({ enrollments: docs.map((d) => shape(d as Record<string, unknown>)).filter(Boolean) });
  }),
);

const enrollSchema = z.object({ courseId: z.string().min(1) });

/**
 * Purchase. There is no gateway yet, so the charge is recorded as settled with
 * provider "manual" — swapping in Razorpay/Cashfree means verifying their
 * signature here and setting paymentProvider/paymentRef before creating this.
 */
enrollmentsRouter.post(
  "/",
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = enrollSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Which course?");

    // A draft must not be purchasable, even by someone holding its id.
    const course = await Course.findOne({ _id: parsed.data.courseId, published: true });
    if (!course) throw new HttpError(404, "Course not found.");

    const existing = await Enrollment.findOne({ user: req.user!.sub, course: course._id });
    if (existing) {
      return res.status(200).json({ alreadyEnrolled: true, slug: course.slug });
    }

    await Enrollment.create({
      user: req.user!.sub,
      course: course._id,
      amountPaid: course.discountPrice ?? course.price,
      paymentStatus: "paid",
      paymentProvider: "manual",
    });

    res.status(201).json({ ok: true, slug: course.slug });
  }),
);

const progressSchema = z.object({ completedLessons: z.coerce.number().int().min(0) });

/** Marks progress; completing every lesson stamps completedAt. */
enrollmentsRouter.patch(
  "/:courseId/progress",
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = progressSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid progress.");

    const enrollment = await Enrollment.findOne({
      user: req.user!.sub,
      course: req.params.courseId,
    }).populate("course");
    if (!enrollment) throw new HttpError(404, "You don't own this course.");

    const total = (enrollment.course as unknown as CourseLike).lessons ?? 0;
    const completed = Math.min(parsed.data.completedLessons, total);

    enrollment.completedLessons = completed;
    enrollment.lastOpenedAt = new Date();
    enrollment.completedAt = completed >= total && total > 0 ? new Date() : undefined;
    await enrollment.save();

    res.json({ ok: true, completedLessons: completed });
  }),
);
