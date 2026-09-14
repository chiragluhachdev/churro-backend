// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

const postSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    excerpt: { type: String, required: true },
    /** Full article. Plain paragraphs separated by blank lines. */
    body: { type: String, default: "" },
    cover: { type: String, required: true },
    category: { type: String, default: "Technique" },
    author: { type: String, default: "Chef Simone Kathuria" },
    publishedAt: { type: Date, default: Date.now },
    readingMinutes: { type: Number, default: 5, min: 1 },
    featured: { type: Boolean, default: false },
    published: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type PostDoc = InferSchemaType<typeof postSchema> & { _id: string };

export const Post: Model<PostDoc> =
  (models.Post as Model<PostDoc>) ?? model<PostDoc>("Post", postSchema);
