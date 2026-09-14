import { Router } from "express";

import { lessonIdsOf, stripPaidVideos } from "../lib/curriculum.js";
import { asyncHandler } from "../lib/http.js";
import { authenticate, requireAuth } from "../middleware/auth.js";
import { Enrollment } from "../models/Enrollment.js";

export const enrollmentsRouter = Router();

/**
 * Enrollments are created only by a confirmed order (routes/orders.ts) and
 * progress changes only through routes/learn.ts. This router is read-only.
 */
export function shapeEnrollment(enrollment: Record<string, unknown>) {
  const course = enrollment.course as ({ _id: unknown; __v?: unknown } & Record<string, unknown>) | null;
  if (!course) return null;

  const { _id: courseId, __v, ...courseRest } = course;
  void __v;
  const lessonIds = lessonIdsOf(course as { curriculum?: { lessons?: { id?: string }[] }[] });
  const valid = new Set(lessonIds);
  // Ids of lessons since deleted by the admin no longer count toward progress.
  const done = ((enrollment.completedLessonIds as string[] | undefined) ?? []).filter((id) => valid.has(id));
  const total = lessonIds.length;
  const progress = total > 0 ? Math.min(100, Math.round((done.length / total) * 100)) : 0;

  return {
    id: String(enrollment._id),
    course: stripPaidVideos({ ...courseRest, id: String(courseId), lessons: total }),
    completedLessons: done.length,
    completedLessonIds: done,
    lastLessonId: (enrollment.lastLessonId as string) || "",
    progress,
    isComplete: total > 0 && done.length >= total,
    lastOpenedAt: new Date(enrollment.lastOpenedAt as string).toISOString(),
    purchasedAt: enrollment.createdAt ? new Date(enrollment.createdAt as string).toISOString() : undefined,
    completedAt: enrollment.completedAt ? new Date(enrollment.completedAt as string).toISOString() : undefined,
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
    res.json({
      enrollments: docs.map((d) => shapeEnrollment(d as Record<string, unknown>)).filter(Boolean),
    });
  }),
);
