// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

const testimonialSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    quote: { type: String, required: true, trim: true },
    /** Longer write-up; entries with one appear as featured stories. */
    story: { type: String, default: "" },
    avatar: { type: String, default: "" },
    rating: { type: Number, default: 5, min: 1, max: 5 },
    /** Course title, as shown under the reviewer's name. */
    course: { type: String, default: "" },
    location: { type: String, default: "" },
    /** Shown in the home page carousel. */
    featured: { type: Boolean, default: false },
    published: { type: Boolean, default: true },
    /** Lower comes first. */
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type TestimonialDoc = InferSchemaType<typeof testimonialSchema> & { _id: string };

export const Testimonial: Model<TestimonialDoc> =
  (models.Testimonial as Model<TestimonialDoc>) ??
  model<TestimonialDoc>("Testimonial", testimonialSchema);
