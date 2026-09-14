// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * The seller's own details for invoices, kept as one document (like
 * ChefProfile) so the admin can correct an address or GSTIN without a deploy.
 */
const billingSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "billing" },
    companyName: { type: String, default: "Churro Academy" },
    gstin: { type: String, default: "" },
    address: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    /** Percent, e.g. 18. Course prices are treated as inclusive of this. */
    gstRate: { type: Number, default: 18, min: 0, max: 100 },
  },
  { timestamps: true },
);

export type BillingSettingsDoc = InferSchemaType<typeof billingSettingsSchema> & { _id: string };

export const BillingSettings: Model<BillingSettingsDoc> =
  (models.BillingSettings as Model<BillingSettingsDoc>) ??
  model<BillingSettingsDoc>("BillingSettings", billingSettingsSchema);
