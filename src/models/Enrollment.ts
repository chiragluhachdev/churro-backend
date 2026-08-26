// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

const enrollmentSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    course: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    /** Lessons ticked off; progress is derived from the course's lesson count. */
    completedLessons: { type: Number, default: 0, min: 0 },
    lastOpenedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },

    /* --- Payment ------------------------------------------------------- */
    /** Rupees actually charged, captured at purchase time. */
    amountPaid: { type: Number, required: true, min: 0 },
    paymentStatus: {
      type: String,
      enum: ["paid", "pending", "failed"],
      default: "paid",
    },
    /**
     * "manual" until Razorpay/Cashfree is wired in; the gateway's order id
     * goes here once it is.
     */
    paymentProvider: { type: String, default: "manual" },
    paymentRef: { type: String, default: "" },
  },
  { timestamps: true },
);

// One enrollment per user per course.
enrollmentSchema.index({ user: 1, course: 1 }, { unique: true });

export type EnrollmentDoc = InferSchemaType<typeof enrollmentSchema> & { _id: string };

export const Enrollment: Model<EnrollmentDoc> =
  (models.Enrollment as Model<EnrollmentDoc>) ??
  model<EnrollmentDoc>("Enrollment", enrollmentSchema);
