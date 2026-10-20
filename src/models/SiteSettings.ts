// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Site-wide switches, kept as one document (like BillingSettings/ChefProfile)
 * so the admin can flip them without a deploy. Currently just the
 * "closed for maintenance" lockout — the frontend's proxy reads this on
 * every public request and swaps in the maintenance page when it's on.
 */
const siteSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "site" },
    maintenanceEnabled: { type: Boolean, default: false },
    /** Shown on the public "we'll be back soon" page. Empty means use the page's own default copy. */
    maintenanceMessage: { type: String, default: "" },
  },
  { timestamps: true },
);

export type SiteSettingsDoc = InferSchemaType<typeof siteSettingsSchema> & { _id: string };

export const SiteSettings: Model<SiteSettingsDoc> =
  (models.SiteSettings as Model<SiteSettingsDoc>) ??
  model<SiteSettingsDoc>("SiteSettings", siteSettingsSchema);
