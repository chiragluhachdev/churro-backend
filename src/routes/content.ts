import { Router } from "express";
import { z } from "zod";

import { asyncHandler, HttpError, onlySentFields } from "../lib/http.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { BillingSettings } from "../models/BillingSettings.js";
import { ChefProfile } from "../models/ChefProfile.js";
import { Post } from "../models/Post.js";
import { Testimonial } from "../models/Testimonial.js";

/** Strips Mongo internals and exposes a string id. */
function clean<T extends Record<string, unknown>>(doc: T) {
  const { _id, __v, ...rest } = doc as T & { _id: unknown; __v?: unknown };
  void __v;
  return { ...rest, id: String(_id) };
}

const slugRule = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Slugs use lowercase letters, numbers and hyphens.");

/* =============================================================== public == */

export const contentRouter = Router();

contentRouter.get(
  "/testimonials",
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = { published: true };
    if (req.query.featured === "true") filter.featured = true;
    const docs = await Testimonial.find(filter).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ testimonials: docs.map((d) => clean(d as Record<string, unknown>)) });
  }),
);

contentRouter.get(
  "/posts",
  asyncHandler(async (_req, res) => {
    const docs = await Post.find({ published: true }).sort({ publishedAt: -1 }).lean();
    res.json({ posts: docs.map((d) => clean(d as Record<string, unknown>)) });
  }),
);

contentRouter.get(
  "/posts/:slug",
  asyncHandler(async (req, res) => {
    const doc = await Post.findOne({ slug: req.params.slug, published: true }).lean();
    if (!doc) throw new HttpError(404, "Post not found.");
    res.json({ post: clean(doc as Record<string, unknown>) });
  }),
);

contentRouter.get(
  "/chef",
  asyncHandler(async (_req, res) => {
    const doc = await ChefProfile.findOne({ key: "chef" }).lean();
    if (!doc) throw new HttpError(404, "Chef profile not set up.");
    res.json({ chef: clean(doc as Record<string, unknown>) });
  }),
);

/** Just the seller details an invoice needs to show — not a secret. */
contentRouter.get(
  "/billing",
  asyncHandler(async (_req, res) => {
    const doc = await BillingSettings.findOne({ key: "billing" }).lean();
    res.json({
      billing: {
        companyName: doc?.companyName || "Churro Academy",
        gstin: doc?.gstin || "",
        address: doc?.address || "",
        email: doc?.email || "",
        phone: doc?.phone || "",
        gstRate: doc?.gstRate ?? 18,
      },
    });
  }),
);

/* ================================================================ admin == */

export const adminContentRouter = Router();
adminContentRouter.use(authenticate, requireAdmin);

/* ---- testimonials ---- */

const testimonialSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  quote: z.string().trim().min(1, "Quote is required."),
  story: z.string().trim().default(""),
  avatar: z.string().trim().default(""),
  rating: z.coerce.number().int().min(1).max(5).default(5),
  course: z.string().trim().default(""),
  location: z.string().trim().default(""),
  featured: z.coerce.boolean().default(false),
  published: z.coerce.boolean().default(true),
  order: z.coerce.number().int().default(0),
});

adminContentRouter.get(
  "/testimonials",
  asyncHandler(async (_req, res) => {
    const docs = await Testimonial.find({}).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ testimonials: docs.map((d) => clean(d as Record<string, unknown>)) });
  }),
);

adminContentRouter.post(
  "/testimonials",
  asyncHandler(async (req, res) => {
    const parsed = testimonialSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid review.");
    const doc = await Testimonial.create(parsed.data);
    res.status(201).json({ testimonial: clean(doc.toObject()) });
  }),
);

adminContentRouter.patch(
  "/testimonials/:id",
  asyncHandler(async (req, res) => {
    const parsed = testimonialSchema.partial().safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid review.");
    const doc = await Testimonial.findByIdAndUpdate(req.params.id, onlySentFields(parsed.data, req.body), { new: true });
    if (!doc) throw new HttpError(404, "Review not found.");
    res.json({ testimonial: clean(doc.toObject()) });
  }),
);

adminContentRouter.delete(
  "/testimonials/:id",
  asyncHandler(async (req, res) => {
    const doc = await Testimonial.findByIdAndDelete(req.params.id);
    if (!doc) throw new HttpError(404, "Review not found.");
    res.json({ ok: true });
  }),
);

/* ---- posts ---- */

const postSchema = z.object({
  title: z.string().trim().min(2, "Title is required."),
  slug: slugRule,
  excerpt: z.string().trim().min(4, "Excerpt is required."),
  body: z.string().default(""),
  cover: z.string().trim().url("Cover must be an image URL."),
  category: z.string().trim().default("Technique"),
  author: z.string().trim().default("Chef Simone Kathuria"),
  publishedAt: z.coerce.date().default(() => new Date()),
  readingMinutes: z.coerce.number().int().min(1).default(5),
  featured: z.coerce.boolean().default(false),
  published: z.coerce.boolean().default(true),
});

adminContentRouter.get(
  "/posts",
  asyncHandler(async (_req, res) => {
    const docs = await Post.find({}).sort({ publishedAt: -1 }).lean();
    res.json({ posts: docs.map((d) => clean(d as Record<string, unknown>)) });
  }),
);

adminContentRouter.post(
  "/posts",
  asyncHandler(async (req, res) => {
    const parsed = postSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid post.");
    if (await Post.exists({ slug: parsed.data.slug })) {
      throw new HttpError(409, "A post with that slug already exists.");
    }
    const doc = await Post.create(parsed.data);
    res.status(201).json({ post: clean(doc.toObject()) });
  }),
);

adminContentRouter.patch(
  "/posts/:id",
  asyncHandler(async (req, res) => {
    const parsed = postSchema.partial().safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid post.");
    if (parsed.data.slug && (await Post.exists({ slug: parsed.data.slug, _id: { $ne: req.params.id } }))) {
      throw new HttpError(409, "A post with that slug already exists.");
    }
    const doc = await Post.findByIdAndUpdate(req.params.id, onlySentFields(parsed.data, req.body), { new: true });
    if (!doc) throw new HttpError(404, "Post not found.");
    res.json({ post: clean(doc.toObject()) });
  }),
);

adminContentRouter.delete(
  "/posts/:id",
  asyncHandler(async (req, res) => {
    const doc = await Post.findByIdAndDelete(req.params.id);
    if (!doc) throw new HttpError(404, "Post not found.");
    res.json({ ok: true });
  }),
);

/* ---- chef ---- */

const chefSchema = z.object({
  name: z.string().trim().min(2, "Name is required."),
  title: z.string().trim().default(""),
  tagline: z.string().trim().default(""),
  bio: z.string().trim().default(""),
  longBio: z.array(z.string().trim()).default([]),
  avatar: z.string().trim().default(""),
  portrait: z.string().trim().default(""),
  specialities: z.array(z.string().trim()).default([]),
  stats: z
    .array(
      z.object({
        value: z.string().trim(),
        label: z.string().trim(),
        icon: z.enum(["experience", "recipes", "students", "passion"]),
      }),
    )
    .default([]),
  socials: z
    .array(
      z.object({
        label: z.string().trim(),
        href: z.string().trim(),
        icon: z.enum(["instagram", "youtube", "pinterest"]),
      }),
    )
    .default([]),
});

adminContentRouter.put(
  "/chef",
  asyncHandler(async (req, res) => {
    const parsed = chefSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid profile.");
    const doc = await ChefProfile.findOneAndUpdate(
      { key: "chef" },
      { ...parsed.data, key: "chef" },
      { new: true, upsert: true },
    );
    res.json({ chef: clean(doc!.toObject()) });
  }),
);

/* ---- billing settings ---- */

const billingSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required."),
  gstin: z.string().trim().default(""),
  address: z.string().trim().default(""),
  email: z.string().trim().default(""),
  phone: z.string().trim().default(""),
  gstRate: z.coerce.number().min(0).max(100).default(18),
});

adminContentRouter.put(
  "/billing",
  asyncHandler(async (req, res) => {
    const parsed = billingSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid billing details.");
    const doc = await BillingSettings.findOneAndUpdate(
      { key: "billing" },
      { ...parsed.data, key: "billing" },
      { new: true, upsert: true },
    );
    res.json({ billing: clean(doc!.toObject()) });
  }),
);
