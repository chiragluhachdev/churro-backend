// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

const enrollmentSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    course: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    /**
     * Ids of lessons the student has finished. Only real lesson ids from the
     * course are ever added, so progress can't be inflated by sending a number.
     */
    completedLessonIds: { type: [String], default: [] },
    /** Cached count of completedLessonIds, for sorting and admin stats. */
    completedLessons: { type: Number, default: 0, min: 0 },
    /** Lesson to reopen the player on. */
    lastLessonId: { type: String, default: "" },
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
    /** "dummy" in test mode, later "razorpay". */
    paymentProvider: { type: String, default: "dummy" },
    /** The Order this enrollment was paid through. */
    order: { type: Schema.Types.ObjectId, ref: "Order" },
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
