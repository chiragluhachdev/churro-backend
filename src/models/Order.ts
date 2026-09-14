// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * A purchase attempt. The amount is fixed server-side when the order is
 * created and is the only figure ever charged — nothing the browser sends can
 * change it. An order moves created -> paid exactly once.
 */
const orderSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    course: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    /** Snapshot for receipts, even if the course is later renamed. */
    courseTitle: { type: String, required: true },
    /** Whole rupees, locked at creation. */
    amount: { type: Number, required: true, min: 0 },
    /** What the list price was, to show the saving. */
    listPrice: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR" },
    status: {
      type: String,
      enum: ["created", "paid", "failed", "expired"],
      default: "created",
      index: true,
    },
    provider: { type: String, enum: ["dummy", "razorpay"], required: true },
    /** Gateway's own order id (Razorpay order_...). */
    providerOrderId: { type: String, default: "" },
    /** Gateway's payment id once captured. */
    providerPaymentId: { type: String, default: "" },
    expiresAt: { type: Date, required: true },
    paidAt: { type: Date },
    failureReason: { type: String, default: "" },
  },
  { timestamps: true },
);

export type OrderDoc = InferSchemaType<typeof orderSchema> & { _id: string };

export const Order: Model<OrderDoc> =
  (models.Order as Model<OrderDoc>) ?? model<OrderDoc>("Order", orderSchema);
