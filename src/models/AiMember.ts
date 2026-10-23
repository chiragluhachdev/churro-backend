// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * A Churro AI user — signs in with their phone number, nothing else. Kept
 * entirely apart from the admin's User account and from course buyers (who
 * have no account at all).
 */
const aiMemberSchema = new Schema(
  {
    /** 10-digit Indian mobile number, digits only. */
    phone: { type: String, required: true, unique: true, index: true },
    /** Filled in when they buy the pass — the invoice needs them. */
    name: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    freeTriesUsed: { type: Number, default: 0 },
    /** End of the free try currently running, if any. */
    trialEndsAt: { type: Date },
    /** Paid access lasts until this moment. */
    passExpiresAt: { type: Date },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

export type AiMemberDoc = InferSchemaType<typeof aiMemberSchema> & { _id: string };

export const AiMember: Model<AiMemberDoc> =
  (models.AiMember as Model<AiMemberDoc>) ?? model<AiMemberDoc>("AiMember", aiMemberSchema);
