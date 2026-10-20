// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Site-wide switches, kept as one document (like BillingSettings/ChefProfile)
 * so the admin can flip them without a deploy. The frontend reads this on
 * every public request (for maintenance mode, via its proxy) or on each page
 * load (for everything else).
 */
const siteSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "site" },
    maintenanceEnabled: { type: Boolean, default: false },
    /** Shown on the public "we'll be back soon" page. Empty means use the page's own default copy. */
    maintenanceMessage: { type: String, default: "" },
    /** Locked by default until the admin turns it on — hides the nav link and the /calculator page itself. */
    calculatorEnabled: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type SiteSettingsDoc = InferSchemaType<typeof siteSettingsSchema> & { _id: string };

export const SiteSettings: Model<SiteSettingsDoc> =
  (models.SiteSettings as Model<SiteSettingsDoc>) ??
  model<SiteSettingsDoc>("SiteSettings", siteSettingsSchema);
