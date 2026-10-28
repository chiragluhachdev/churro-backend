// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * A Churro AI user — signs in with their email address and a one-time code,
 * nothing else. Kept entirely apart from the admin's User account and from
 * course buyers (who have no account at all).
 */
const aiMemberSchema = new Schema(
  {
    /** The sign-in identity. Lowercased, so "Asha@x.com" and "asha@x.com" are one member. */
    email: { type: String, default: "", trim: true, lowercase: true },
    /** Filled in when they buy the pass — the invoice needs it. */
    name: { type: String, default: "", trim: true },
    /** Only on early members, who signed in by phone before email sign-in replaced it. */
    phone: { type: String },
    freeTriesUsed: { type: Number, default: 0 },
    /** End of the free try currently running, if any. */
    trialEndsAt: { type: Date },
    /** Paid access lasts until this moment. */
    passExpiresAt: { type: Date },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

// Unique only among real addresses: early phone-only members have email "".
aiMemberSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $gt: "" } } });

export type AiMemberDoc = InferSchemaType<typeof aiMemberSchema> & { _id: string };

export const AiMember: Model<AiMemberDoc> =
  (models.AiMember as Model<AiMemberDoc>) ?? model<AiMemberDoc>("AiMember", aiMemberSchema);
