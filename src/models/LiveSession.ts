// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * A one-off live-class announcement, broadcast by email to every student
 * who has ever paid for a course the moment it's created. There's no
 * in-app calendar or RSVP — the record here is just a log of what was
 * announced, when, and how many inboxes it actually reached.
 */
const liveSessionSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    /** Zoom/Meet/YouTube Live link — whatever the chef is hosting it on. */
    link: { type: String, required: true, trim: true },
    /** When the class happens. Always rendered to students in IST. */
    scheduledAt: { type: Date, required: true },
    sentAt: { type: Date },
    recipientCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type LiveSessionDoc = InferSchemaType<typeof liveSessionSchema> & { _id: string };

export const LiveSession: Model<LiveSessionDoc> =
  (models.LiveSession as Model<LiveSessionDoc>) ?? model<LiveSessionDoc>("LiveSession", liveSessionSchema);
