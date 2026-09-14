// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * A purchase — the single record of who bought what and how much they paid.
 * Checkout is guest-only (course materials are sent by hand over WhatsApp
 * afterward, not unlocked in-app), so the buyer's own details are captured
 * directly on the order rather than through an account. The amount is fixed
 * server-side when the order is created and is the only figure ever charged —
 * nothing the browser sends can change it. An order moves created -> paid
 * exactly once.
 */
const orderSchema = new Schema(
  {
    buyerName: { type: String, required: true, trim: true },
    buyerEmail: { type: String, required: true, trim: true, lowercase: true, index: true },
    /** WhatsApp number the chef sends the course materials to. */
    buyerPhone: { type: String, required: true, trim: true },
    course: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    /** Snapshot for receipts, even if the course is later renamed. */
    courseTitle: { type: String, required: true },
    /** Whole rupees, inclusive of GST, locked at creation. */
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
    /** Assigned once, the moment the order is marked paid. */
    invoiceNumber: { type: String, default: "" },
    /** The "you're enrolled" email with lesson links — set once it's actually sent. */
    emailSentAt: { type: Date },
    /** Last delivery failure, if any, so the admin can see why and retry. */
    emailError: { type: String, default: "" },
  },
  { timestamps: true },
);

export type OrderDoc = InferSchemaType<typeof orderSchema> & { _id: string };

export const Order: Model<OrderDoc> =
  (models.Order as Model<OrderDoc>) ?? model<OrderDoc>("Order", orderSchema);
