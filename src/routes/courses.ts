import { Router } from "express";
import { z } from "zod";

import { normalizeCurriculum, stripLessonVideos } from "../lib/curriculum.js";
import { asyncHandler, HttpError, onlySentFields } from "../lib/http.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { Course } from "../models/Course.js";
import { Order } from "../models/Order.js";

export const coursesRouter = Router();

function withId(doc: Record<string, unknown>) {
  const { _id, __v, ...rest } = doc as Record<string, unknown> & { _id: unknown };
  void __v;
  return { ...rest, id: String(_id) };
}

/** What the catalogue pages may see: no video links — those are for a paying buyer's inbox. */
const publicCourse = (doc: Record<string, unknown>) => stripLessonVideos(withId(doc));

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
  authenticate,
  asyncHandler(async (req, res) => {
    // Drafts are invisible to the public; admins can still preview them.
    const filter: Record<string, unknown> = { slug: req.params.slug };
    if (req.user?.role !== "admin") filter.published = true;
    const doc = await Course.findOne(filter).lean();
    if (!doc) throw new HttpError(404, "Course not found.");
    res.json({ course: publicCourse(doc as Record<string, unknown>) });
  }),
);

/* ---------------------------------------------------------------- admin -- */

const lessonSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1, "Every lesson needs a title."),
  duration: z.coerce.number().min(0).default(0),
  videoUrl: z
    .string()
    .trim()
    .default("")
    .refine((v) => v === "" || /^https?:\/\//i.test(v), "Lesson video must be a full https:// link."),
});

const moduleSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1, "Every section needs a title."),
  lessons: z.array(lessonSchema).default([]),
});

const courseSchema = z.object({
  title: z.string().trim().min(2, "Give the course a title."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Slugs use lowercase letters, numbers and hyphens."),
  shortDescription: z.string().trim().min(4, "Add a short description."),
  description: z.string().trim().default(""),
  thumbnail: z.string().url("Thumbnail must be a URL."),
  heroImage: z.string().default(""),
  price: z.coerce.number({ message: "Enter a price." }).min(0, "Price can't be negative."),
  discountPrice: z.coerce.number().min(0).optional().nullable(),
  level: z.enum(["Beginner", "Intermediate", "Advanced"]),
  duration: z.string().default(""),
  category: z.string().trim().min(2, "Add a category."),
  featured: z.coerce.boolean().default(false),
  published: z.coerce.boolean().default(true),
  badge: z.string().optional(),
  curriculum: z.array(moduleSchema).default([]),
  whatYouWillLearn: z.array(z.string().trim().min(1)).default([]),
  includedItems: z.array(z.string().trim().min(1)).default([]),
  requirements: z.array(z.string().trim().min(1)).default([]),
  faqs: z.array(z.object({ question: z.string().trim().min(1), answer: z.string().trim().min(1) })).default([]),
});

type CourseInput = z.infer<typeof courseSchema>;

/** Shared rules for create and update. */
function prepare(data: Partial<CourseInput>) {
  const out: Record<string, unknown> = { ...data };
  if (data.discountPrice != null && data.price !== undefined && data.discountPrice >= data.price) {
    throw new HttpError(400, "Sale price has to be lower than the regular price.");
  }
  if (data.curriculum) {
    const { curriculum, lessonCount } = normalizeCurriculum(data.curriculum);
    out.curriculum = curriculum;
    out.lessons = lessonCount;
  }
  return out;
}

coursesRouter.post(
  "/",
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = courseSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid course.");
    if (await Course.exists({ slug: parsed.data.slug })) {
      throw new HttpError(409, "A course with that slug already exists.");
    }
    const data = prepare(parsed.data);
    if (data.published && !(data.lessons as number)) {
      throw new HttpError(400, "Add at least one lesson before publishing.");
    }
    const course = await Course.create({
      ...data,
      instructor: { id: "chef-simone", name: "Chef Simone Kathuria", title: "Founder & Head Pastry Chef", avatar: "" },
    });
    res.status(201).json({ course: withId(course.toObject()) });
  }),
);

coursesRouter.patch(
  "/:id",
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = courseSchema.partial().safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid course.");

    const existing = await Course.findById(req.params.id).lean();
    if (!existing) throw new HttpError(404, "Course not found.");

    const sent = onlySentFields(parsed.data, req.body);
    // Compare the prices that will actually be in effect after this update —
    // lowering the price below an existing sale price must be caught too.
    const effectivePrice = sent.price ?? existing.price;
    const effectiveSale = "discountPrice" in sent ? sent.discountPrice : existing.discountPrice ?? undefined;
    if (effectiveSale != null && effectiveSale >= effectivePrice) {
      throw new HttpError(400, "Sale price has to be lower than the regular price.");
    }
    const data = prepare({ ...sent, discountPrice: undefined } as Partial<CourseInput>);
    if ("discountPrice" in sent) {
      if (sent.discountPrice == null) data.$unset = { discountPrice: 1 };
      else data.discountPrice = sent.discountPrice;
    }
    if (sent.slug && sent.slug !== existing.slug && (await Course.exists({ slug: sent.slug }))) {
      throw new HttpError(409, "A course with that slug already exists.");
    }
    const willPublish = sent.published ?? existing.published;
    const lessonCount =
      (data.lessons as number | undefined) ??
      (existing.curriculum ?? []).reduce((n, m) => n + (m.lessons?.length ?? 0), 0);
    if (willPublish && lessonCount === 0) throw new HttpError(400, "Add at least one lesson before publishing.");

    const course = await Course.findByIdAndUpdate(req.params.id, data, { new: true });
    res.json({ course: withId(course!.toObject()) });
  }),
);

coursesRouter.delete(
  "/:id",
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    // Paying customers must never lose a course that's on their invoice.
    const sold = await Order.countDocuments({ course: req.params.id, status: "paid" });
    if (sold > 0) {
      throw new HttpError(
        409,
        `${sold} paid order${sold === 1 ? "" : "s"} exist for this course, so it can't be deleted. Unpublish it to stop selling it.`,
      );
    }
    const course = await Course.findByIdAndDelete(req.params.id);
    if (!course) throw new HttpError(404, "Course not found.");
    res.json({ ok: true });
  }),
);
