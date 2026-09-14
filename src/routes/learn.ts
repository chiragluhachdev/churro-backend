import { Router } from "express";

import { lessonIdsOf } from "../lib/curriculum.js";
import { asyncHandler, HttpError } from "../lib/http.js";
import { authenticate, requireAuth } from "../middleware/auth.js";
import { Course } from "../models/Course.js";
import { Enrollment } from "../models/Enrollment.js";

export const learnRouter = Router();
learnRouter.use(authenticate, requireAuth);

/**
 * Loads the course with its full lesson videos — the only endpoint that
 * returns them. Owners get their progress; admins may preview any course.
 */
learnRouter.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const isAdmin = req.user!.role === "admin";
    const course = await Course.findOne({ slug: req.params.slug }).lean();
    if (!course) throw new HttpError(404, "Course not found.");

    const enrollment = isAdmin ? null : await Enrollment.findOne({ user: req.user!.sub, course: course._id });
    if (!isAdmin && !enrollment) throw new HttpError(403, "You don't own this course.");

    const lessonIds = lessonIdsOf(course);
    const valid = new Set(lessonIds);
    const done = (enrollment?.completedLessonIds ?? []).filter((id) => valid.has(id));

    if (enrollment) {
      enrollment.lastOpenedAt = new Date();
      await enrollment.save();
    }

    const { _id, __v, ...rest } = course as typeof course & { __v?: unknown };
    void __v;
    res.json({
      course: { ...rest, id: String(_id), lessons: lessonIds.length },
      progress: {
        completedLessonIds: done,
        completedLessons: done.length,
        totalLessons: lessonIds.length,
        percent: lessonIds.length ? Math.round((done.length / lessonIds.length) * 100) : 0,
        lastLessonId: enrollment?.lastLessonId && valid.has(enrollment.lastLessonId) ? enrollment.lastLessonId : "",
        isComplete: lessonIds.length > 0 && done.length >= lessonIds.length,
      },
      preview: isAdmin,
    });
  }),
);

async function setLessonState(userId: string, slug: string, lessonId: string, complete: boolean) {
  const course = await Course.findOne({ slug }).lean();
  if (!course) throw new HttpError(404, "Course not found.");
  const lessonIds = lessonIdsOf(course);
  // Only a lesson that actually exists in this course can be marked.
  if (!lessonIds.includes(lessonId)) throw new HttpError(404, "Lesson not found.");

  const enrollment = await Enrollment.findOne({ user: userId, course: course._id });
  if (!enrollment) throw new HttpError(403, "You don't own this course.");

  const set = new Set(enrollment.completedLessonIds.filter((id) => lessonIds.includes(id)));
  if (complete) set.add(lessonId);
  else set.delete(lessonId);

  // Stored in curriculum order so it reads naturally anywhere it's shown.
  enrollment.completedLessonIds = lessonIds.filter((id) => set.has(id));
  enrollment.completedLessons = enrollment.completedLessonIds.length;
  enrollment.lastLessonId = lessonId;
  enrollment.lastOpenedAt = new Date();
  const finished = enrollment.completedLessons >= lessonIds.length && lessonIds.length > 0;
  enrollment.completedAt = finished ? (enrollment.completedAt ?? new Date()) : undefined;
  await enrollment.save();

  return {
    completedLessonIds: enrollment.completedLessonIds,
    completedLessons: enrollment.completedLessons,
    totalLessons: lessonIds.length,
    percent: Math.round((enrollment.completedLessons / lessonIds.length) * 100),
    isComplete: finished,
  };
}

function studentOnly(role: string) {
  if (role !== "student") throw new HttpError(403, "Previewing as admin — progress isn't recorded.");
}

learnRouter.post(
  "/:slug/lessons/:lessonId/complete",
  asyncHandler(async (req, res) => {
    studentOnly(req.user!.role);
    res.json({ progress: await setLessonState(req.user!.sub, String(req.params.slug), String(req.params.lessonId), true) });
  }),
);

learnRouter.delete(
  "/:slug/lessons/:lessonId/complete",
  asyncHandler(async (req, res) => {
    studentOnly(req.user!.role);
    res.json({ progress: await setLessonState(req.user!.sub, String(req.params.slug), String(req.params.lessonId), false) });
  }),
);

/** Remembers the lesson being watched, so the player reopens there. */
learnRouter.post(
  "/:slug/lessons/:lessonId/open",
  asyncHandler(async (req, res) => {
    if (req.user!.role !== "student") return res.json({ ok: true });
    const course = await Course.findOne({ slug: req.params.slug }).select("_id curriculum").lean();
    if (!course || !lessonIdsOf(course).includes(String(req.params.lessonId))) throw new HttpError(404, "Lesson not found.");
    await Enrollment.updateOne(
      { user: req.user!.sub, course: course._id },
      { lastLessonId: req.params.lessonId, lastOpenedAt: new Date() },
    );
    res.json({ ok: true });
  }),
);
