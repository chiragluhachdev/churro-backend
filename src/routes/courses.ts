import { Router } from "express";
import { z } from "zod";

import { asyncHandler, HttpError } from "../lib/http.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { Course } from "../models/Course.js";

export const coursesRouter = Router();

function publicCourse(doc: Record<string, unknown>) {
  const { _id, __v, ...rest } = doc as Record<string, unknown> & { _id: unknown };
  void __v;
  return { ...rest, id: String(_id) };
}

/** Public catalogue. `?featured=true` narrows to the home-page picks. */
coursesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = { published: true };
    if (req.query.featured === "true") filter.featured = true;
    const docs = await Course.find(filter).sort({ createdAt: 1 }).lean();
    res.json({ courses: docs.map((d) => publicCourse(d as Record<string, unknown>)) });
  }),
);

coursesRouter.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const doc = await Course.findOne({ slug: req.params.slug }).lean();
    if (!doc) throw new HttpError(404, "Course not found.");
    res.json({ course: publicCourse(doc as Record<string, unknown>) });
  }),
);

/* ---------------------------------------------------------------- admin -- */

const courseSchema = z.object({
  title: z.string().trim().min(2),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Slugs use lowercase letters, numbers and hyphens."),
  shortDescription: z.string().trim().min(4),
  description: z.string().trim().default(""),
  thumbnail: z.string().url("Thumbnail must be a URL."),
  heroImage: z.string().default(""),
  price: z.coerce.number().min(0),
  discountPrice: z.coerce.number().min(0).optional(),
  level: z.enum(["Beginner", "Intermediate", "Advanced"]),
  duration: z.string().default(""),
  lessons: z.coerce.number().int().min(1),
  category: z.string().trim().min(2),
  featured: z.coerce.boolean().default(false),
  published: z.coerce.boolean().default(true),
  badge: z.string().optional(),
});

coursesRouter.post(
  "/",
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = courseSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid course.");
    }
    if (await Course.exists({ slug: parsed.data.slug })) {
      throw new HttpError(409, "A course with that slug already exists.");
    }
    const course = await Course.create({
      ...parsed.data,
      instructor: { id: "chef-simone", name: "Chef Simone Kathuria", title: "Founder & Head Pastry Chef", avatar: "" },
      curriculum: [],
      whatYouWillLearn: [],
      includedItems: [],
    });
    res.status(201).json({ course: publicCourse(course.toObject()) });
  }),
);

coursesRouter.patch(
  "/:id",
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = courseSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid course.");
    }
    const course = await Course.findByIdAndUpdate(req.params.id, parsed.data, { new: true });
    if (!course) throw new HttpError(404, "Course not found.");
    res.json({ course: publicCourse(course.toObject()) });
  }),
);

coursesRouter.delete(
  "/:id",
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const course = await Course.findByIdAndDelete(req.params.id);
    if (!course) throw new HttpError(404, "Course not found.");
    res.json({ ok: true });
  }),
);
