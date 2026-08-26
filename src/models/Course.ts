// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

const lessonSchema = new Schema(
  {
    title: { type: String, required: true },
    duration: { type: Number, required: true },
    preview: { type: Boolean, default: false },
  },
  { _id: false },
);

const moduleSchema = new Schema(
  {
    title: { type: String, required: true },
    lessons: [lessonSchema],
  },
  { _id: false },
);

const courseSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    shortDescription: { type: String, required: true },
    description: { type: String, default: "" },
    thumbnail: { type: String, required: true },
    heroImage: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    discountPrice: { type: Number, min: 0 },
    instructor: {
      id: String,
      name: String,
      title: String,
      avatar: String,
    },
    level: {
      type: String,
      enum: ["Beginner", "Intermediate", "Advanced"],
      default: "Beginner",
    },
    duration: { type: String, default: "" },
    lessons: { type: Number, required: true, min: 1 },
    rating: { type: Number, default: 5, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
    category: { type: String, required: true },
    featured: { type: Boolean, default: false },
    published: { type: Boolean, default: true },
    badge: { type: String },
    curriculum: [moduleSchema],
    whatYouWillLearn: [String],
    includedItems: [String],
  },
  { timestamps: true },
);

export type CourseDoc = InferSchemaType<typeof courseSchema> & { _id: string };

export const Course: Model<CourseDoc> =
  (models.Course as Model<CourseDoc>) ?? model<CourseDoc>("Course", courseSchema);
