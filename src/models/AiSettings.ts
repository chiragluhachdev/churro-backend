// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Everything the admin can tune about Churro AI, as one document. Kept apart
 * from SiteSettings because Churro AI is headed for its own domain.
 */
const aiSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "ai" },
    /** Master switch for the Recipe Calculator — off means "coming soon" for everyone but the admin. */
    calculatorEnabled: { type: Boolean, default: false },
    passName: { type: String, default: "Churro AI Pass" },
    /** Whole rupees, GST inclusive — same convention as course prices. */
    passPrice: { type: Number, default: 999, min: 1 },
    passDays: { type: Number, default: 365, min: 1 },
    /** How many free tries each new member gets before they have to buy the pass. */
    freeTries: { type: Number, default: 1, min: 0 },
    /** How long one free try stays open once started. */
    trialMinutes: { type: Number, default: 60, min: 1 },
    /** Offer "renews automatically" at checkout (Razorpay Subscriptions), alongside paying once. */
    autoRenewEnabled: { type: Boolean, default: true },
    /** Razorpay plans can't be edited, so one is made per price + length; this is the current one. */
    razorpayPlanId: { type: String, default: "" },
    /** `${price}:${days}` the plan above was made for — a change means a new plan. */
    razorpayPlanKey: { type: String, default: "" },
  },
  { timestamps: true },
);

export type AiSettingsDoc = InferSchemaType<typeof aiSettingsSchema> & { _id: string };

export const AiSettings: Model<AiSettingsDoc> =
  (models.AiSettings as Model<AiSettingsDoc>) ?? model<AiSettingsDoc>("AiSettings", aiSettingsSchema);
