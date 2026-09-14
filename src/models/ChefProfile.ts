// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * The site has one chef, so this is a single document keyed "chef". Stored as
 * a document rather than config so the admin can edit it without a deploy.
 */
const chefSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "chef" },
    name: { type: String, required: true },
    title: { type: String, default: "" },
    tagline: { type: String, default: "" },
    bio: { type: String, default: "" },
    longBio: [String],
    avatar: { type: String, default: "" },
    /** Optional hosted portrait; the bundled photo is used when empty. */
    portrait: { type: String, default: "" },
    specialities: [String],
    stats: [
      {
        _id: false,
        value: String,
        label: String,
        icon: { type: String, enum: ["experience", "recipes", "students", "passion"] },
      },
    ],
    socials: [
      {
        _id: false,
        label: String,
        href: String,
        icon: { type: String, enum: ["instagram", "youtube", "pinterest"] },
      },
    ],
  },
  { timestamps: true },
);

export type ChefDoc = InferSchemaType<typeof chefSchema> & { _id: string };

export const ChefProfile: Model<ChefDoc> =
  (models.ChefProfile as Model<ChefDoc>) ?? model<ChefDoc>("ChefProfile", chefSchema);
