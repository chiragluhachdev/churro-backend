// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

/** One outstanding sign-in code per phone. Only a hash is stored; Mongo drops it once expired. */
const aiOtpSchema = new Schema(
  {
    phone: { type: String, required: true, unique: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type AiOtpDoc = InferSchemaType<typeof aiOtpSchema> & { _id: string };

export const AiOtp: Model<AiOtpDoc> = (models.AiOtp as Model<AiOtpDoc>) ?? model<AiOtpDoc>("AiOtp", aiOtpSchema);
