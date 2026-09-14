// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

const lessonSchema = new Schema(
  {
    /**
     * Stable id. Progress is stored as a list of these, so a lesson keeps its
     * completion state when the admin reorders or renames it.
     */
    id: { type: String, required: true },
    title: { type: String, required: true },
    /** Minutes. */
    duration: { type: Number, default: 0, min: 0 },
    /** Free preview: its video is visible to anyone on the course page. */
    preview: { type: Boolean, default: false },
    /**
     * YouTube, Vimeo or a direct video file (e.g. a Cloudinary upload).
     * Never sent to the public unless `preview` is true.
     */
    videoUrl: { type: String, default: "" },
    /** Notes shown under the player. */
    description: { type: String, default: "" },
  },
  { _id: false },
);

const moduleSchema = new Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    lessons: [lessonSchema],
  },
  { _id: false },
);

const faqSchema = new Schema(
  {
    question: { type: String, required: true },
    answer: { type: String, required: true },
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
    /** Display string, e.g. "4h 10m". Editable; the editor offers the lesson total. */
    duration: { type: String, default: "" },
    /** Always derived from the curriculum — never set by hand. */
    lessons: { type: Number, default: 0, min: 0 },
    rating: { type: Number, default: 5, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
    category: { type: String, required: true },
    featured: { type: Boolean, default: false },
    published: { type: Boolean, default: true },
    badge: { type: String },
    curriculum: [moduleSchema],
    whatYouWillLearn: [String],
    includedItems: [String],
    requirements: [String],
    faqs: [faqSchema],
  },
  { timestamps: true },
);

export type CourseDoc = InferSchemaType<typeof courseSchema> & { _id: string };

export const Course: Model<CourseDoc> =
  (models.Course as Model<CourseDoc>) ?? model<CourseDoc>("Course", courseSchema);
